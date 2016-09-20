const BaseSQLModel = require('./BaseSQLModel');
const { ModelField } = require('silence-js-base-model');

function create(proto) {
  let name = proto.name;
  if (!name) {
    throw new Error('SQLModel.create need name');
  }
  let table = proto.table || name.replace(/(.)([A-Z])/g, (m, m0, m1) => `${m0}_${m1.toLowerCase()}`).toLowerCase();
  if (!proto.fields || !Array.isArray(proto.fields)) {
    throw new Error('SQLModel.create need fields');
  }
  let fields = new Array(proto.fields.length);
  let pk = '';
  let autoUpdateTimestampFieldIndex = -1;
  
  for(let i = 0; i < proto.fields.length; i++) {
    let field = new ModelField(proto.fields[i]);
    if (!field.name) {
      throw new Error(`Field must have 'name', please check fields of ${this.name}`);
    } else if(['constructor'].indexOf(field.name) >= 0) {
      throw new Error(`Field name can not be ${field.name}, it's reserved words`);
    } else if (!field.type) {
      throw new Error(`Field ${field.name} must have 'type', please check fields of ${this.name}`);
    } else {
      let result = BaseSQLModel.__db.initField(field);
      if (result === -1) {
        throw new Error(`Unknown field type ${field.dbType || field.type}, please check fields of ${this.name}`);
      } else if (result === -2) {
        throw new Error(`Unsupported defaultValue of field ${field.name}, please check fields of ${this.name}`);
      } else if (result === -3) {
        throw new Error(`autoUpdate can only been applied to TIMESTAMP field with defaultValue 'now'`);
      }
    }
    if (field.isPrimaryKey === true) {
      pk = field.name;
    }
    if (autoUpdateTimestampFieldIndex < 0 && field.autoUpdate) {
      autoUpdateTimestampFieldIndex = i;
    }
    fields[i] = field;
  }

  let funcStr = `
class ${name} extends BaseSQLModel {
  constructor(values, assignDefaultValue = true) {
  super();
  const fields = this.constructor.fields;
  ${fields.map((field, idx) => {
    return`
  this.${field.name} = values && values.hasOwnProperty('${field.name}') 
      ? values.${field.name} : (assignDefaultValue ? fields[${idx}].defaultValue : undefined);
`;    
  }).join('\n')}
  }
}

${name}.table = '${table}';
${name}.primaryKey = '${pk}';
${name}.fields = fields;
${name}.fieldsTypeMap = new Map();
${name}.autoUpdateTimestampField = autoUpdateTimestampFieldIndex < 0 ? null : fields[autoUpdateTimestampFieldIndex];

return ${name};

`;

  let Class = (new Function('BaseSQLModel', 'fields', 'autoUpdateTimestampFieldIndex', funcStr))(
    BaseSQLModel,
    fields,
    autoUpdateTimestampFieldIndex
  );

  fields.forEach(field => {
    Class.fieldsTypeMap.set(field.name, field.type);
  });

  return Class;
}

module.exports = create;
