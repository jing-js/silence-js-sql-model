'use strict';

const BaseSQLModel = require('./BaseSQLModel');

const SQLModel = {
  __init(db, logger) {
    if (BaseSQLModel.__db) {
      throw new Error('BaseSQLModel.__db already exists. __init can be called only once.');
    }
    BaseSQLModel.__db = db;
    BaseSQLModel.__logger = logger;
  },
  create: require('./create'),
  isSQLModel(ModelClass) {
    return Object.getPrototypeOf(ModelClass) === BaseSQLModel;
  }
};


module.exports = SQLModel;
