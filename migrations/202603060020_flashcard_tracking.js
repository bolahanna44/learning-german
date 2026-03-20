exports.up = async function up(knex) {
  const hasSuccessStreak = await knex.schema.hasColumn('words', 'success_streak');
  if (!hasSuccessStreak) {
    await knex.schema.table('words', (table) => {
      table.integer('success_streak').notNullable().defaultTo(0);
    });
  }

  const hasIsLearned = await knex.schema.hasColumn('words', 'is_learned');
  if (!hasIsLearned) {
    await knex.schema.table('words', (table) => {
      table.integer('is_learned').notNullable().defaultTo(0);
    });
  }
};

exports.down = async function down() {
  // Columns retained to preserve spaced-repetition data.
};
