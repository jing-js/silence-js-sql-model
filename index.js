'use strict';

const BaseModel = require('silence-js-base-model');

class SQLModel extends BaseModel {
  static get isDatabaseModel() {
    return true;
  }
  static get info() {
    if (!this.__info) {
      this.__info = {
        fields: null,
        indices: null,
        table: null,
        primaryKey: null,
        sql: null
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
    for(let i = 0; i < fields.length; i++) {
      let fd = fields[i];
      if (!fd.name) {
        throw new Error(`Field must have 'name'`);
      } else if (!fd.type) {
        throw new Error('Field must have \'type\'');
      }
      let result = this.db.initField(fd);
      if (result === -1) {
        throw new Error(`Unknown field type ${fd.dbType || fd.type}`);
      }
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
      if (!Array.isArray(fields)) {
        this.logger.error(`${this.name} model must have array type 'fields' property`);
      }
      for(let i = 0; i < fields.length; i++) {
        if (fields[i].primaryKey === true) {
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
    return this.remove({
      [this.primaryKey] : pk
    });
  }
  static remove(conditions) {
    let queryFields = [], queryParams = [];
    for(let k in conditions) {
      queryFields.push(`\`${k}\`` + '=?');
      queryParams.push(conditions[k]);
    }
    let queryString = `DELETE from ${this.table} WHERE ${queryFields.join(' AND ')}`;
    return this.db.exec(queryString, queryParams).then(result => {
      return result.affectedRows;
    });
  }
  static update(conditions, fields) {
    let queryFields = [], queryParams = [];
    for(let k in fields) {
      queryFields.push(`\`${k}\`` + '=?');
      queryParams.push(fields[k]);
    }
    let conditionFields = [];
    for(let k in conditions) {
      conditionFields.push(`\`${k}\`` + '=?');
      queryParams.push(conditions[k]);
    }
    let queryString = `UPDATE \`${this.table}\` SET  ${queryFields.join(', ')} WHERE ${conditionFields.join(' AND ')}`;
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
      conditionFields.push(`\`${k}\`` + '=?');
      conditionParams.push(conditions[k]);
    }
    let conditionString = conditionFields.length > 0 ? `WHERE ${conditionFields.join(' AND ')}` : '';
    let limitString = options.limit ? ("LIMIT " + (options.offset ? options.offset + ', ' : '') + options.limit) : '';
    let orderString = options.orderBy ? "ORDER BY " + (_.isArray(options.orderBy) ? options.orderBy.join(',') : options.orderBy) : '';
    let queryString = `SELECT ${fields} from ${this.table} ${conditionString} ${orderString} ${limitString};`;
    return this.db.query(queryString, conditionParams);
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
    let queryString = `SELECT ${countField} as N from ${this.table} ${conditionString} ${orderString} ${limitString};`;
    return this.db.query(queryString, conditionParams).then(result => {
      return result[0].N;
    });
  }
  _saveOrUpdate(updateConditions, validate) {
    if (validate && !this.validate(updateConditions !== null)) {
      return Promise.resolve(false);
    }
    let fields = this.constructor.fields;
    let pk = this.constructor.primaryKey;
    let queryFields = [], queryParams = [];
    for(let i = 0; i < fields.length; i++) {
      let f = fields[i].name;
      if (this[f] !== undefined) {
        queryFields.push(`\`${f}\`${updateConditions ? '=?' : ''}`);
        queryParams.push(this[f]);
      }
    }
    let queryString;
    if (updateConditions) {
      let conditionFields = [];
      for(let k in updateConditions) {
        conditionFields.push(`\`${k}\`` + '=?');
        queryParams.push(updateConditions[k]);
      }
      queryString = `UPDATE ${this.constructor.table} SET  ${queryFields.join(', ')} WHERE ${conditionFields.join(' AND ')}`;
    } else {
      queryString = `INSERT INTO ${this.constructor.table} (${queryFields.join(',')}) VALUES (${queryFields.map(()=>'?').join(',')})`;
    }
    return this.constructor.db.exec(queryString, queryParams)
  }
  save(validate = true) {
    return this._saveOrUpdate(null, validate).then(result => {
      if (!result || result.affectedRows <= 0) {
        return false;
      }
      let pk = this.constructor.primaryKey;
      this[pk] = result.insertId;
      return true;
    });
  }
  update(validate = true) {
    let pk = this.constructor.primaryKey;
    return this._saveOrUpdate({
      [pk] : this[pk]
    }, validate).then(result => {
      return result.affectedRows > 0;
    });
  }
  remove() {
    let pk = this.constructor.primaryKey;
    if (!pk || !this[pk]) {
      return Promise.resolve(false);
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
