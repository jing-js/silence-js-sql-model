const { BaseModel } = require('silence-js-base-model');
const EMPTY = {};

class BaseSQLModel extends BaseModel {
  constructor() {
    super();
  }
  static get db() {
    return BaseSQLModel.__db;
  }
  static get logger() {
    return BaseSQLModel.__logger;
  }
  static dropTable() {
    return this.db.exec(`DROP TABLE IF EXISTS \`${this.table}\``);
  }
  static createTable() {
    return this.db.exec(this.db.genCreateTableSQL(this));
  }
  static remove(conditions) {
    let queryFields = [], queryParams = [];
    this.__dealConditions(queryFields, queryParams, conditions);
    let queryString = `DELETE from \`${this.table}\` WHERE ${queryFields.join(' AND ')}`;
    return this.db.exec(queryString, queryParams).then(result => {
      return result.affectedRows;
    });
  }

  static update(conditions, fields) {
    let queryFields = [], queryParams = [];
    for(let k in fields) {
      if (k === this.primaryKey) {
        continue;
      }
      if (!this.fieldsTypeMap.has(k)) {
        continue;
      }
      let type = this.fieldsTypeMap.get(k);
      let v = fields[k];
      queryFields.push(`\`${k}\`` + '=?');
      queryParams.push(type === 'boolean' ? (v ? 1 : 0) : v);
    }

    let af = this.autoUpdateTimestampField;
    let mt = -1;
    if (af && !fields.hasOwnProperty(af.name)) {
      mt = af.defaultValue;
      queryFields.push(`\`${af.name}\`=?`);
      queryParams.push(mt);
    }

    let conditionFields = [];
    this.__dealConditions(conditionFields, queryParams, conditions);
    let queryString = `UPDATE \`${this.table}\` SET  ${queryFields.join(', ')} WHERE ${conditionFields.join(' AND ')}`;
    return this.db.exec(queryString, queryParams).then(result => {
      return result.affectedRows > 0 ? (mt > 0 ? {
        modifyTime: mt
      } : true) : false;
    });
  }
  static __dealConditions(conditionFields, conditionParams, conditions) {
    if (Array.isArray(conditions)) {
      conditionFields.push(`\`${this.primaryKey}\` in (${conditions.map(item => '?').join(',')})`);
      conditionParams.push(...conditions);
    } else if (typeof conditions === 'object') {
      for(let k in conditions) {
        if (!this.fieldsTypeMap.has(k)) {
          continue;
        }
        let type = this.fieldsTypeMap.get(k);
        let v = conditions[k];
        if (type === 'boolean') {
          v = v ? 1 : 0;
        }
        if (Array.isArray(v)) {
          conditionFields.push(`\`${k}\` in (${v.map(item => '?').join(',')})`);
          conditionParams.push(...v);
        } else {
          conditionFields.push(`\`${k}\`=?`);
          conditionParams.push(v);
        }
      }
    } else {
      conditionFields.push(`\`${this.primaryKey}\`=?`);
      conditionParams.push(conditions);
    }
  }
  static all(conditions = EMPTY, options = EMPTY) {
    let fields = typeof options.fields === 'string' ? options.fields : (Array.isArray(options.fields) ? options.fields.join(',') : '*');
    let conditionFields = [], conditionParams = [];
    this.__dealConditions(conditionFields, conditionParams, conditions);
    let conditionString = conditionFields.length > 0 ? `WHERE ${conditionFields.join(' AND ')}` : '';
    let limitString = options.limit ? ("LIMIT " + (options.offset ? options.offset + ', ' : '') + options.limit) : '';
    let orderString = options.orderBy ? "ORDER BY " + (_.isArray(options.orderBy) ? options.orderBy.join(',') : options.orderBy) : '';
    let queryString = `SELECT ${fields} from \`${this.table}\` ${conditionString} ${orderString} ${limitString};`;
    return this.db.query(queryString, conditionParams).then(rows => {
      return rows.map(row => {
        return new this(row, false);
      });
    });
  }
  static one(primaryKeyOrConditions = EMPTY, options = EMPTY) {
    let conditions = typeof primaryKeyOrConditions === 'object' && !Array.isArray(primaryKeyOrConditions)
      ? primaryKeyOrConditions : {
      [this.primaryKey]: primaryKeyOrConditions
    };
    return this.all(conditions,  Object.assign({
      limit: 1
    }, options)).then(rows => {
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
  static count(conditions = EMPTY, options = EMPTY) {
    let conditionFields = [], conditionParams = [];
    this.__dealConditions(conditionFields, conditionParams, conditions);
    let countField = `COUNT(${options.count ? options.count : '*'})`;
    let conditionString = conditionFields.length > 0 ? `WHERE ${conditionFields.join(' AND ')}` : '';
    let limitString = options.limit ? ("LIMIT " + (options.offset ? options.offset + ', ' : '') + options.limit) : '';
    let orderString = options.orderBy ? "ORDER BY " + (_.isArray(options.orderBy) ? options.orderBy.join(',') : options.orderBy) : '';
    let queryString = `SELECT ${countField} as N from \`${this.table}\` ${conditionString} ${orderString} ${limitString};`;
    return this.db.query(queryString, conditionParams).then(result => {
      return result && result[0] ? result[0].N : 0;
    });
  }
  _saveOrUpdate(updatePK, validate) {
    if (validate && !this.validate(updatePK !== null)) {
      return Promise.resolve(false);
    }
    let Class = this.constructor;
    let fields = Class.fields;
    let queryFields = [], queryParams = [];
    for(let i = 0; i < fields.length; i++) {
      let fn = fields[i].name;
      let v = this[fn];
      if (fn !== Class.primaryKey &&  v !== undefined) {
        queryFields.push(`\`${fn}\`${updatePK ? '=?' : ''}`);
        queryParams.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
      }
    }
    let queryString;
    if (updatePK) {
      let af = Class.autoUpdateTimestampField;
      if (af && this[af.name] === undefined) {
        this[af.name] = af.defaultValue;
        queryFields.push(`\`${af.name}\`=?`);
        queryParams.push(this[af.name]);
      }
      queryParams.push(this[updatePK]);
      queryString = `UPDATE \`${Class.table}\` SET ${queryFields.join(', ')} WHERE \`${updatePK}\`=?`;
    } else {
      queryString = `INSERT INTO \`${Class.table}\` (${queryFields.join(', ')}) VALUES (${queryFields.map(()=>'?').join(', ')})`;
    }
    return Class.db.exec(queryString, queryParams)
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

BaseSQLModel.__db = null;
BaseSQLModel.__logger = null;

module.exports = BaseSQLModel;
