import { describe, expect, it } from 'vitest';
import { allIpcChannels } from './api.js';
import { IPC_ARGS } from './ipc-args.js';

const ID = '0b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';
const OTHER_ID = '5d2c8f1a-3b4e-4c6d-8e9f-0a1b2c3d4e5f';

describe('IPC_ARGS', () => {
  it('defines an argument schema for exactly the declared channels', () => {
    expect(Object.keys(IPC_ARGS).sort()).toEqual(allIpcChannels().sort());
  });

  it('rejects surplus arguments on parameterless channels', () => {
    expect(IPC_ARGS['app:info'].safeParse([]).success).toBe(true);
    expect(IPC_ARGS['app:info'].safeParse(['extra']).success).toBe(false);
  });

  it('validates id arguments', () => {
    expect(IPC_ARGS['tasks:get'].safeParse([ID]).success).toBe(true);
    expect(IPC_ARGS['tasks:get'].safeParse(['../../etc/passwd']).success).toBe(false);
    expect(IPC_ARGS['tasks:get'].safeParse([]).success).toBe(false);
  });

  it('requires an expected version for task writes (D05)', () => {
    expect(IPC_ARGS['tasks:update'].safeParse([ID, 3, { priority: 'HIGH' }]).success).toBe(true);
    expect(IPC_ARGS['tasks:update'].safeParse([ID, { priority: 'HIGH' }]).success).toBe(false);
    expect(IPC_ARGS['tasks:update'].safeParse([ID, -1, {}]).success).toBe(false);
  });

  it('accepts an optional sort key when moving', () => {
    expect(IPC_ARGS['tasks:move'].safeParse([ID, 1, OTHER_ID]).success).toBe(true);
    expect(IPC_ARGS['tasks:move'].safeParse([ID, 1, OTHER_ID, 'a0V']).success).toBe(true);
    expect(IPC_ARGS['tasks:move'].safeParse([ID, 1, OTHER_ID, 'a0V0']).success).toBe(false);
  });

  it('never accepts a file path for avatar selection (T5)', () => {
    expect(IPC_ARGS['users:chooseAvatar'].safeParse([ID]).success).toBe(true);
    expect(IPC_ARGS['users:chooseAvatar'].safeParse([ID, 'C:/avatar.png']).success).toBe(false);
    expect(IPC_ARGS['users:removeAvatar'].safeParse(['avatar.png']).success).toBe(false);
  });

  it('validates device settings patches', () => {
    const schema = IPC_ARGS['settings:updateDevice'];
    expect(schema.safeParse([{ theme: 'light', language: 'de' }]).success).toBe(true);
    expect(schema.safeParse([{ theme: 'blue' }]).success).toBe(false);
    expect(schema.safeParse([{ autoBackup: { folder: 'C:/x' } }]).success).toBe(false);
  });
});
