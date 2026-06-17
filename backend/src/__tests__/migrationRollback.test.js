const fs = require('fs');
const path = require('path');

describe('BP-09: Migration Rollback', () => {
  const migrationsDir = path.join(__dirname, '../migrations');

  describe('Rollback files', () => {
    it('should have rollback files for all migrations', () => {
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.match(/^\d{3}_.+\.sql$/) && !file.match(/_rollback\.sql$/) && file !== 'migrate.sql');

      for (const migrationFile of migrationFiles) {
        const rollbackFile = migrationFile.replace(/\.sql$/, '_rollback.sql');
        const rollbackPath = path.join(migrationsDir, rollbackFile);
        expect(fs.existsSync(rollbackPath)).toBe(true);
      }
    });

    it('should have rollback files for each migration', () => {
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.match(/^\d{3}_.+\.sql$/) && !file.match(/_rollback\.sql$/) && file !== 'migrate.sql');

      const rollbackFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.match(/_rollback\.sql$/));

      expect(rollbackFiles.length).toBe(migrationFiles.length);
    });

    it('should have rollback content in each file', () => {
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.match(/^\d{3}_.+\.sql$/) && !file.match(/_rollback\.sql$/) && file !== 'migrate.sql');

      for (const migrationFile of migrationFiles) {
        const rollbackFile = migrationFile.replace(/\.sql$/, '_rollback.sql');
        const rollbackPath = path.join(migrationsDir, rollbackFile);
        const content = fs.readFileSync(rollbackPath, 'utf8');
        expect(content.length).toBeGreaterThan(0);
        expect(content).toMatch(/DROP|ALTER/);
      }
    });
  });

  describe('Rollback script', () => {
    it('should exist', () => {
      const rollbackPath = path.join(migrationsDir, 'rollback.js');
      expect(fs.existsSync(rollbackPath)).toBe(true);
    });

    it('should export functions', () => {
      const rollback = require('../migrations/rollback');
      expect(typeof rollback).toBe('object');
    });
  });
});
