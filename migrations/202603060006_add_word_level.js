exports.up = async function up(knex) {
  const hasLevel = await knex.schema.hasColumn('words', 'word_level');
  if (!hasLevel) {
    await knex.schema.table('words', (table) => {
      table.string('word_level').notNullable().defaultTo('');
    });
  }
};

exports.down = async function down() {
  // Column retained to avoid data loss.
};
