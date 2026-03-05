module.exports = {
  development: {
    client: 'better-sqlite3',
    connection: {
      filename: './learning-german.sqlite',
    },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations',
    },
  },
};
