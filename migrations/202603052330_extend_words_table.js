exports.up = async function up(knex) {
  const hasWordTranslation = await knex.schema.hasColumn('words', 'word_translation');
  if (!hasWordTranslation) {
    await knex.schema.table('words', (table) => {
      table.text('word_translation').notNullable().defaultTo('');
    });
  }

  const hasWordType = await knex.schema.hasColumn('words', 'word_type');
  if (!hasWordType) {
    await knex.schema.table('words', (table) => {
      table.string('word_type').notNullable().defaultTo('');
    });
  }
};

exports.down = async function down() {
  // Columns are retained to avoid data loss.
};
