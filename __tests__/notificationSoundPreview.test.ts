import { describe, expect, it } from 'vitest';
import {
  buildNotificationSoundPreviewMessage,
  getQmuxHelperSocketPath,
} from '../src/utils/notificationSoundPreview.js';

describe('notification sound preview commands', () => {
  it('routes the system sound preview through the helper without a bundled resource', () => {
    expect(
      buildNotificationSoundPreviewMessage('default-system-sound', 'darwin')
    ).toEqual({
      type: 'preview-sound',
      soundName: undefined,
    });
  });

  it('routes bundled sound previews through the helper resource name', () => {
    expect(buildNotificationSoundPreviewMessage('harp', 'darwin')).toEqual({
      type: 'preview-sound',
      soundName: 'qmux-harp.caf',
    });
  });

  it('disables preview messages outside macOS', () => {
    expect(buildNotificationSoundPreviewMessage('harp', 'linux')).toBeNull();
  });

  it('uses the default helper socket path', () => {
    expect(getQmuxHelperSocketPath('/tmp/home')).toBe(
      '/tmp/home/.qmux/native-helper/run/qmux-helper.sock'
    );
  });
});
