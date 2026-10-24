// SPDX-License-Identifier: AGPL-3.0-or-later

import {BUILD_CHANNEL, type BuildChannel} from '@electron/common/BuildChannel';

const DESKTOP_APP_NAMES: Record<BuildChannel, string> = {
	stable: 'DAOI Chat',
	canary: 'DAOI Chat Canary',
	development: 'DAOI Chat Development',
};
const MACOS_BUNDLE_IDS: Record<BuildChannel, string> = {
	stable: 'ai.daoi.chat',
	canary: 'ai.daoi.chat.canary',
	development: 'ai.daoi.chat.development',
};
const LINUX_DESKTOP_ENTRY_IDS: Record<BuildChannel, string> = {
	stable: 'app.fluxer.FluxerDesktop',
	canary: 'app.fluxer.FluxerDesktopCanary',
	development: 'app.fluxer.FluxerDesktopDevelopment',
};
const LEGACY_LINUX_DESKTOP_ENTRY_IDS: Record<BuildChannel, string> = {
	stable: 'fluxer',
	canary: 'fluxer-canary',
	development: 'fluxer-development',
};
const LINUX_PORTAL_SESSION_TOKENS: Record<BuildChannel, string> = {
	stable: 'fluxer_global_shortcuts',
	canary: 'fluxer_canary_global_shortcuts',
	development: 'fluxer_development_global_shortcuts',
};
const WINDOWS_VELOPACK_IDS: Record<BuildChannel, string> = {
	stable: 'daoi_chat_desktop',
	canary: 'daoi_chat_desktop_canary',
	development: 'daoi_chat_desktop_development',
};
const WINDOWS_APP_USER_MODEL_IDS: Record<BuildChannel, string> = {
	stable: 'ai.daoi.chat',
	canary: 'ai.daoi.chat.Canary',
	development: 'ai.daoi.chat.Development',
};
const WINDOWS_TOAST_ACTIVATOR_CLSIDS: Record<BuildChannel, string> = {
	stable: '{12C8440C-9E04-46BA-8715-A8D841E5864E}',
	canary: '{B5E4CFF1-725A-44B9-9D21-3FCD6F093317}',
	development: '{40298BF6-E063-40D5-8CFD-B515EA573F14}',
};

export const DESKTOP_APP_NAME = DESKTOP_APP_NAMES[BUILD_CHANNEL];
export const MACOS_BUNDLE_ID = MACOS_BUNDLE_IDS[BUILD_CHANNEL];
export const LINUX_DESKTOP_ENTRY_ID = LINUX_DESKTOP_ENTRY_IDS[BUILD_CHANNEL];
export const LINUX_PORTAL_SESSION_TOKEN = LINUX_PORTAL_SESSION_TOKENS[BUILD_CHANNEL];
export const LEGACY_LINUX_DESKTOP_ENTRY_ID = LEGACY_LINUX_DESKTOP_ENTRY_IDS[BUILD_CHANNEL];
export const LINUX_ICON_NAME = LEGACY_LINUX_DESKTOP_ENTRY_IDS[BUILD_CHANNEL];
export const WINDOWS_SHORTCUT_AUTHOR = 'DAOI';
export const WINDOWS_VELOPACK_ID = WINDOWS_VELOPACK_IDS[BUILD_CHANNEL];
export const WINDOWS_LEGACY_SQUIRREL_ID = 'daoi_chat_app';
export const WINDOWS_APP_USER_MODEL_ID = WINDOWS_APP_USER_MODEL_IDS[BUILD_CHANNEL];
export const WINDOWS_LEGACY_APP_USER_MODEL_IDS = [`velopack.${WINDOWS_VELOPACK_ID}`];
export const WINDOWS_TOAST_ACTIVATOR_CLSID = WINDOWS_TOAST_ACTIVATOR_CLSIDS[BUILD_CHANNEL];
