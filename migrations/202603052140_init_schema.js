const progressColumns = ['a11_progress', 'a12_progress', 'a21_progress', 'a22_progress', 'b11_progress', 'b12_progress'];

exports.up = async function up(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) {
    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('email').notNullable().unique();
      table.string('password_hash').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      progressColumns.forEach((column) => {
        table.integer(column).notNullable().defaultTo(0);
      });
    });
  } else {
    for (const column of progressColumns) {
      const exists = await knex.schema.hasColumn('users', column);
      if (!exists) {
        await knex.schema.table('users', (table) => {
          table.integer(column).notNullable().defaultTo(0);
        });
      }
    }
  }

  const hasWords = await knex.schema.hasTable('words');
  if (!hasWords) {
    await knex.schema.createTable('words', (table) => {
      table.string('word').primary();
      table.text('sentence').notNullable().defaultTo('');
      table.text('translation').notNullable().defaultTo('');
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  } else {
    const hasTranslation = await knex.schema.hasColumn('words', 'translation');
    if (!hasTranslation) {
      await knex.schema.table('words', (table) => {
        table.text('translation').notNullable().defaultTo('');
      });
    }
  }
};

exports.down = async function down(knex) {
  const hasWords = await knex.schema.hasTable('words');
  if (hasWords) {
    await knex.schema.dropTable('words');
  }
  // We intentionally do not drop the users table in down() to avoid data loss.
};
