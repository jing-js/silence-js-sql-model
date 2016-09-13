'use strict';

const BaseModel = require('silence-js-base-model');
const ModelField = BaseModel.ModelField;

class SQLModel extends BaseModel {
  static get info() {
    if (!this.__info) {
      this.__info = {
        fieldsTypeMap: {},
        fields: null,
        indices: null,
        table: null,
        primaryKey: null,
        sql: null,
        autoUpdateTimestampField: null
      };
    }
    return this.__info;
  }
  static get logger() {
    return SQLModel.__logger;
  }
  static get db() {
    return SQLModel.__db;
  }
  static get indices() {
    return this.info.indices;
  }
  static set indices(val) {
    this.info.indices = val;
  }
  static get fields() {
    return this.info.fields;
  }
  static set fields(fields) {
    fields = fields.map(f => {
      let field = new ModelField(f);
      if (!field.name) {
        this.logger.error(`Field must have 'name', please check fields of ${this.name}`);
      } else if (!field.type) {
        this.logger.error(`Field ${field.name} must have 'type', please check fields of ${this.name}`);
      } else {
        let result = this.db.initField(field);
        if (result === -1) {
          this.logger.error(`Unknown field type ${field.dbType || field.type}, please check fields of ${this.name}`);
        } else if (result === -2) {
          this.logger.error(`Unsupport defaultValue of field ${field.name}, please check fields of ${this.name}`);
        } else if (result === -3) {
          this.logger.error(`autoUpdate can only been applied to TIMESTAMP field with defaultValue 'now'`);
        } else {
          return field;
        }
      }
      return null;
    }).filter(f => !!f);

    for(let i = 0; i < fields.length; i++) {
      if (fields[i].autoUpdate) {
        this.info.autoUpdateTimestampField = fields[i];
      }
      this.info.fieldsTypeMap[fields[i].name] = fields[i].type;
    }

    this.info.fields = fields;

  }
  static get table() {
    if (this.info.table === null) {
      this.info.table = this.name.toLowerCase(); // this means constructor
    }
    return this.info.table;
  }
  static set table(tableName) {
    this.info.table = tableName;
  }
  static get primaryKey() {
    if (this.info.primaryKey === null) {
      let fields = this.fields;
      for(let i = 0; i < fields.length; i++) {
        if (fields[i].isPrimaryKey === true) {
          this.info.primaryKey = fields[i].name;
          return this.info.primaryKey;
        }
      }
      this.info.primaryKey = '';
    }
    return this.info.primaryKey;
  }
  static dropTable() {
    return this.db.exec(`DROP TABLE IF EXISTS \`${this.table}\``);
  }
  static createTable() {
    return this.db.exec(this.db.genCreateTableSQL(this));
  }
  static removeByPK(pk) {
    return this.db.exec(`DELETE from \`${this.table}\` WHERE \`${this.primaryKey}\`=?`, pk).then(result => {
      return result.affectedRows;
    });
  }
  static remove(conditions) {
    let queryFields = [], queryParams = [];
    for(let k in conditions) {
      queryFields.push(`\`${k}\`` + '=?');
      queryParams.push(conditions[k]);
    }
    let queryString = `DELETE from \`${this.table}\` WHERE ${queryFields.join(' AND ')}`;
    return this.db.exec(queryString, queryParams).then(result => {
      return result.affectedRows;
    });
  }

  static updateByPK(pk, fields) {
    return this.update(pk, fields);
  }

  static update(conditions, fields) {
    let queryFields = [], queryParams = [];
    for(let k in fields) {
      if (k === this.primaryKey) {
        continue;
      }
      let type = this.info.fieldsTypeMap[k];
      if (!type) {
        continue;
      }
      let v = fields[k];
      queryFields.push(`\`${k}\`` + '=?');
      queryParams.push(type === 'boolean' ? (v ? 1 : 0) : v);
    }
    let af = this.info.autoUpdateTimestampField;
    if (af && !fields.hasOwnProperty(af.name)) {
      queryFields.push(`\`${af.name}\`=?`);
      queryParams.push(af.defaultValue);
    }

    let queryString;

    if (typeof conditions === 'object') {
      let conditionFields = [];
      for(let k in conditions) {
        let type = this.info.fieldsTypeMap[k];
        if (!type) {
          continue;
        }
        let v = conditions[k];
        conditionFields.push(`\`${k}\`=?`);
        queryParams.push(type === 'boolean' ? (v ? 1 : 0) : v);
      }
      queryString = `UPDATE \`${this.table}\` SET  ${queryFields.join(', ')} WHERE ${conditionFields.join(' AND ')}`;
    } else {
      queryString = `UPDATE \`${this.table}\` SET  ${queryFields.join(', ')} WHERE ${this.primaryKey}=?`;
      queryParams.push(conditions);
    }

    return this.db.exec(queryString, queryParams).then(result => {
      return result.affectedRows > 0;
    });
  }
  static all(conditions, options) {
    conditions = conditions || {};
    options = options || {};
    let fields = typeof options.fields === 'string' ? options.fields : (Array.isArray(options.fields) ? options.fields.join(',') : '*');
    let conditionFields = [], conditionParams = [];
    for(let k in conditions) {
      let type = this.info.fieldsTypeMap[k];
      if (!type) {
        continue;
      }
      let v = conditions[k];
      conditionFields.push(`\`${k}\`=?`);
      conditionParams.push(type === 'boolean' ? (v ? 1 : 0) : v);
    }
    let conditionString = conditionFields.length > 0 ? `WHERE ${conditionFields.join(' AND ')}` : '';
    let limitString = options.limit ? ("LIMIT " + (options.offset ? options.offset + ', ' : '') + options.limit) : '';
    let orderString = options.orderBy ? "ORDER BY " + (_.isArray(options.orderBy) ? options.orderBy.join(',') : options.orderBy) : '';
    let queryString = `SELECT ${fields} from \`${this.table}\` ${conditionString} ${orderString} ${limitString};`;
    return this.db.query(queryString, conditionParams).then(rows => {
      return rows.map(row => {
        let m = new this(false);
        m.assign(row);
        return m;
      });
    });
  }
  static one(primaryKeyOrConditions = {}, options) {
    let conditions = typeof primaryKeyOrConditions === 'object'
      ? primaryKeyOrConditions : {
      [this.primaryKey]: primaryKeyOrConditions
    };
    return this.all(conditions,  Object.assign(options || {}, {
      limit: 1
    })).then(rows => {
      return rows.length > 0 ? rows[0] : null;
    });
  }
  static touch(primaryKeyId) {
    return this.one({
      [this.primaryKey]: primaryKeyId
    }, {
      fields: [this.primaryKey]
    });
  }
  static count(conditions, options) {
    conditions = conditions || {};
    options = options || {};
    let conditionFields = [], conditionParams = [];
    for(let k in conditions) {
      conditionFields.push(`\`${k}\`` + '=?');
      conditionParams.push(conditions[k]);
    }
    let countField = `COUNT(${options.count ? options.count : (this.primaryKey ? this.primaryKey : '*')})`;
    let conditionString = conditionFields.length > 0 ? `WHERE ${conditionFields.join(' AND ')}` : '';
    let limitString = options.limit ? ("LIMIT " + (options.offset ? options.offset + ', ' : '') + options.limit) : '';
    let orderString = options.orderBy ? "ORDER BY " + (_.isArray(options.orderBy) ? options.orderBy.join(',') : options.orderBy) : '';
    let queryString = `SELECT ${countField} as N from \`${this.table}\` ${conditionString} ${orderString} ${limitString};`;
    return this.db.query(queryString, conditionParams).then(result => {
      return result[0].N;
    });
  }
  _saveOrUpdate(updatePK, validate) {
    if (validate && !this.validate(updatePK !== null)) {
      return Promise.resolve(false);
    }
    let fields = this.constructor.fields;
    let queryFields = [], queryParams = [];
    for(let i = 0; i < fields.length; i++) {
      let fn = fields[i].name;
      let v = this[fn];
      if (fn !== this.constructor.primaryKey &&  v !== undefined) {
        queryFields.push(`\`${fn}\`${updatePK ? '=?' : ''}`);
        queryParams.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
      }
    }
    let queryString;
    if (updatePK) {
      let af = this.constructor.info.autoUpdateTimestampField;
      if (af && this[af.name] === undefined) {
        this[af.name] = af.defaultValue;
        queryFields.push(`\`${af.name}\`=?`);
        queryParams.push(this[af.name]);
      }
      queryParams.push(this[updatePK]);
      queryString = `UPDATE \`${this.constructor.table}\` SET ${queryFields.join(', ')} WHERE \`${updatePK}\`=?`;
    } else {
      queryString = `INSERT INTO \`${this.constructor.table}\` (${queryFields.join(', ')}) VALUES (${queryFields.map(()=>'?').join(', ')})`;
    }
    return this.constructor.db.exec(queryString, queryParams)
  }
  save(validate = true) {
    return this._saveOrUpdate(null, validate).then(result => {
      if (!result || result.affectedRows <= 0) {
        return false;
      }
      let pk = this.constructor.primaryKey;
      pk && (this[pk] = result.insertId);
      return true;
    });
  }
  update(validate = true) {
    let pk = this.constructor.primaryKey;
    if (!pk || typeof this[pk] === 'undefined' || this[pk] === null) {
      return Promise.reject(`update can only been applied to model with primaryKey, please check model: ${this.constructor.name}`);
    }
    return this._saveOrUpdate(pk, validate).then(result => {
      return result.affectedRows > 0;
    });
  }
  remove() {
    let pk = this.constructor.primaryKey;
    if (!pk || typeof this[pk] === 'undefined' || this[pk] === null) {
      return Promise.reject(`remove can only been applied to model with primaryKey, please check model: ${this.constructor.name}`);
    }
    return this.constructor.remove({
      [pk]: this[pk]
    }).then(result => {
      return result !== 0;
    });
  }
}

SQLModel.__db = null;
SQLModel.__logger = null;

module.exports = SQLModel;
