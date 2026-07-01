/**
 * Tests for config persistence (S1) — migration logic for user home config.
 *
 * Exercises migrateConfig() against the real filesystem paths by backing up
 * and restoring state around each test case.
 *
 * The three branches:
 *   1. User config (~/.antigravity/.env) exists → return it directly
 *   2. Package .env exists, no user config → copy package .env to user home
 *   3. Neither exists → copy .env.example to user home
 *   4. Fallback (no .env.example) → return ENV_PATH
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { USER_CONFIG_DIR, USER_ENV_PATH, ENV_PATH, ENV_EXAMPLE } from '../src/cli/utils/paths.js';
import { migrateConfig } from '../src/cli/utils/config-migration.js';

describe('Config Persistence', () => {
  // Backup state before all tests, restore after all tests
  let hadUserEnv: boolean;
  let userEnvBackup: string | null = null;

  before(() => {
    hadUserEnv = fs.existsSync(USER_ENV_PATH);
    if (hadUserEnv) {
      userEnvBackup = fs.readFileSync(USER_ENV_PATH, 'utf-8');
    }
  });

  after(() => {
    // Restore original state
    if (hadUserEnv && userEnvBackup !== null) {
      fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
      fs.writeFileSync(USER_ENV_PATH, userEnvBackup);
    } else if (!hadUserEnv && fs.existsSync(USER_ENV_PATH)) {
      fs.unlinkSync(USER_ENV_PATH);
    }
  });

  it('should return USER_ENV_PATH when user config already exists', () => {
    // Ensure user config exists
    fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
    const marker = `TEST_MARKER_${Date.now()}`;
    fs.writeFileSync(USER_ENV_PATH, `${marker}\n`);

    const result = migrateConfig();

    assert.equal(result, USER_ENV_PATH);
    // Verify file was NOT overwritten (original content preserved)
    const content = fs.readFileSync(result, 'utf-8');
    assert.ok(content.includes(marker), 'Existing user config should not be overwritten');
  });

  it('should copy package .env to user home when user config is missing', () => {
    // Remove user config if present
    if (fs.existsSync(USER_ENV_PATH)) {
      fs.unlinkSync(USER_ENV_PATH);
    }

    // If package .env doesn't exist (CI), create a temporary one for this test
    const envExisted = fs.existsSync(ENV_PATH);
    const testContent = `TEST_KEY=ci_test_value\nPROXY_PORT=443\n`;
    if (!envExisted) {
      fs.writeFileSync(ENV_PATH, testContent, 'utf-8');
    }

    try {
      const result = migrateConfig();

      assert.equal(result, USER_ENV_PATH);
      assert.ok(fs.existsSync(USER_ENV_PATH), 'User config should have been created');
      // Verify the copied content matches the package .env
      const packageContent = fs.readFileSync(ENV_PATH, 'utf-8');
      const userContent = fs.readFileSync(USER_ENV_PATH, 'utf-8');
      assert.equal(userContent, packageContent, 'User config should be a copy of package .env');
    } finally {
      // Clean up temp .env if we created it
      if (!envExisted && fs.existsSync(ENV_PATH)) {
        fs.unlinkSync(ENV_PATH);
      }
    }
  });

  it('should copy .env.example when neither user config nor package .env exists', () => {
    // Remove user config if present
    if (fs.existsSync(USER_ENV_PATH)) {
      fs.unlinkSync(USER_ENV_PATH);
    }

    // Temporarily rename package .env so it appears missing (if it exists)
    const envBackup = ENV_PATH + '.test-backup';
    const hadEnv = fs.existsSync(ENV_PATH);
    if (hadEnv) {
      fs.renameSync(ENV_PATH, envBackup);
    }

    try {
      assert.ok(!fs.existsSync(ENV_PATH), 'Package .env should be absent during this test');
      assert.ok(fs.existsSync(ENV_EXAMPLE), '.env.example should exist for this test');

      const result = migrateConfig();

      assert.equal(result, USER_ENV_PATH);
      assert.ok(fs.existsSync(USER_ENV_PATH), 'User config should have been created from .env.example');
      const exampleContent = fs.readFileSync(ENV_EXAMPLE, 'utf-8');
      const userContent = fs.readFileSync(USER_ENV_PATH, 'utf-8');
      assert.equal(userContent, exampleContent, 'User config should be a copy of .env.example');
    } finally {
      // Always restore package .env if we renamed it
      if (hadEnv) {
        fs.renameSync(envBackup, ENV_PATH);
      }
    }
  });

  it('should create USER_CONFIG_DIR if it does not exist', () => {
    // Safety: only test the directory-creation branch when the directory is absent.
    // On systems where ~/.antigravity already exists, just verify migration works.
    if (fs.existsSync(USER_CONFIG_DIR)) {
      // Directory already present — verify migrateConfig still works correctly
      if (fs.existsSync(USER_ENV_PATH)) {
        fs.unlinkSync(USER_ENV_PATH);
      }
      const result = migrateConfig();
      assert.equal(result, USER_ENV_PATH);
      assert.ok(fs.existsSync(USER_ENV_PATH), 'User config file should exist after migration');
      return;
    }

    // Directory absent — test that migrateConfig creates it
    const result = migrateConfig();

    assert.ok(fs.existsSync(USER_CONFIG_DIR), 'User config directory should have been created');
    assert.ok(fs.existsSync(USER_ENV_PATH), 'User config file should have been created');
    assert.equal(result, USER_ENV_PATH);
  });

  it('should always return a path ending in .antigravity/.env for normal cases', () => {
    // Remove user config to trigger migration
    if (fs.existsSync(USER_ENV_PATH)) {
      fs.unlinkSync(USER_ENV_PATH);
    }

    const result = migrateConfig();

    assert.ok(
      result.endsWith(path.join('.antigravity', '.env')),
      `Expected path ending in .antigravity/.env, got: ${result}`
    );
  });

  it('should fall back to ENV_PATH when no config source is available', () => {
    // This edge case requires both user config and all package sources to be absent.
    // Temporarily rename package .env and .env.example.
    if (fs.existsSync(USER_ENV_PATH)) {
      fs.unlinkSync(USER_ENV_PATH);
    }

    const envBackup = ENV_PATH + '.test-backup';
    const exampleBackup = ENV_EXAMPLE + '.test-backup';

    const hadEnv = fs.existsSync(ENV_PATH);
    const hadExample = fs.existsSync(ENV_EXAMPLE);

    if (hadEnv) fs.renameSync(ENV_PATH, envBackup);
    if (hadExample) fs.renameSync(ENV_EXAMPLE, exampleBackup);

    try {
      assert.ok(!fs.existsSync(ENV_PATH), 'Package .env should be absent');
      assert.ok(!fs.existsSync(ENV_EXAMPLE), '.env.example should be absent');

      const result = migrateConfig();

      // Fallback returns ENV_PATH (the package .env location, even though it doesn't exist)
      assert.equal(result, ENV_PATH);
    } finally {
      if (hadEnv) fs.renameSync(envBackup, ENV_PATH);
      if (hadExample) fs.renameSync(exampleBackup, ENV_EXAMPLE);
    }
  });
});