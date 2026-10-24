// SPDX-License-Identifier: AGPL-3.0-or-later

import {EmailVerificationAlert} from '@app/features/app/components/dialogs/components/EmailVerificationAlert';
import {UnclaimedAccountAlert} from '@app/features/app/components/dialogs/components/UnclaimedAccountAlert';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {openClaimAccountModal} from '@app/features/auth/components/modals/ClaimAccountModal';
import {canResendVerificationEmail} from '@app/features/auth/hooks/useVerifyEmailAction';
import {useSudo} from '@app/features/auth/hooks/useSudo';
import {SsoLinkContextMismatchError, startSsoLink} from '@app/features/auth/state/AuthFlow';
import * as RouterUtils from '@app/features/navigation/utils/RouterUtils';
import {isAbortError} from '@app/features/platform/utils/PlatformHelpers';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {navigateToExternalURL} from '@app/features/ui/utils/NativeUtils';
import {EmailChangeModal} from '@app/features/user/components/modals/EmailChangeModal';
import {PasswordChangeModal} from '@app/features/user/components/modals/PasswordChangeModal';
import {
	AccountSecurityCard,
	AccountSecurityRow,
} from '@app/features/user/components/modals/tabs/account_security_tab/AccountSecurityCard';
import styles from '@app/features/user/components/modals/tabs/account_security_tab/AccountTab.module.css';
import {
	RecoveryKitReminderAlert,
	RecoveryKitRow,
} from '@app/features/user/components/modals/tabs/account_security_tab/RecoveryKitSettings';
import type {User} from '@app/features/user/models/User';
import * as DateUtils from '@app/features/user/utils/DateFormatting';
import {
	HIDE_EMAIL_TOGGLE_DESCRIPTOR,
	REVEAL_DESCRIPTOR as REVEAL_EMAIL_TOGGLE_DESCRIPTOR,
} from '@app/features/user/utils/UserMessageDescriptors';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {type FC, useState} from 'react';

const SIGN_IN_METHODS_DESCRIPTOR = msg({
	message: 'Sign-in methods',
	comment: 'Accessible name for the group of email, password and recovery kit rows in account settings.',
});
const maskEmail = (email: string): string => {
	const [username, domain] = email.split('@');
	const maskedUsername = username.replace(/./g, '*');
	return `${maskedUsername}@${domain}`;
};

interface AccountTabProps {
	user: User;
	isClaimed: boolean;
	showMaskedEmail: boolean;
	setShowMaskedEmail: (show: boolean) => void;
}

export const AccountTabContent: FC<AccountTabProps> = observer(
	({user, isClaimed, showMaskedEmail, setShowMaskedEmail}) => {
		const {i18n} = useLingui();
		const usesUsernameSignIn = RuntimeConfig.usesUsernameSignIn;
		const sudo = useSudo();
		const [linkingWallet, setLinkingWallet] = useState(false);
		const [walletLinkError, setWalletLinkError] = useState<string | null>(null);
		const showWalletLink = usesUsernameSignIn && RuntimeConfig.getSnapshotOrNull()?.sso?.enabled === true;
		const walletCopy = i18n.locale.startsWith('zh') ? {
			label: 'DAOI 钱包',
			description: '绑定后，用钱包登录仍进入这个账号，已有群、私聊和历史继续保留。',
			button: '绑定 DAOI 钱包',
			error: '暂时无法开始钱包绑定，请重试。',
			changed: '当前账号或聊天服务器已变化，请重新打开账号设置。',
		} : {
			label: 'DAOI wallet',
			description: 'Sign in to this same account with your wallet. Keep your communities, chats and history.',
			button: 'Link DAOI wallet',
			error: 'Wallet linking could not be started. Please try again.',
			changed: 'The active account or chat server changed. Reopen account settings.',
		};
		const linkWallet = async () => {
			if (linkingWallet) return;
			setLinkingWallet(true);
			setWalletLinkError(null);
			try {
				const verification = await sudo.require();
				const {authorizationUrl} = await startSsoLink({
					verification,
					linkTargetUserId: user.id,
					runtimeSnapshot: RuntimeConfig.getSnapshot(),
					redirectTo: RouterUtils.getCurrentPath(),
				});
				sudo.finalize();
				await navigateToExternalURL(authorizationUrl);
			} catch (error) {
				if (!isAbortError(error)) setWalletLinkError(error instanceof SsoLinkContextMismatchError ? walletCopy.changed : walletCopy.error);
			} finally {
				setLinkingWallet(false);
			}
		};
		const emailRow = usesUsernameSignIn ? null : isClaimed ? (
			<AccountSecurityRow
				label={<Trans>Email address</Trans>}
				description={
					<span
						className={styles.emailRow}
						data-flx="user.account-security-tab.account-tab.account-tab-content.email-value"
					>
						<span
							className={`${styles.emailText} ${showMaskedEmail ? styles.emailTextSelectable : ''}`}
							data-flx="user.account-security-tab.account-tab.account-tab-content.email-text"
						>
							{showMaskedEmail ? user.email : maskEmail(user.email!)}
						</span>
						<button
							type="button"
							className={styles.toggleButton}
							onClick={() => setShowMaskedEmail(!showMaskedEmail)}
							data-flx="user.account-security-tab.account-tab.account-tab-content.toggle-button"
						>
							{showMaskedEmail ? i18n._(HIDE_EMAIL_TOGGLE_DESCRIPTOR) : i18n._(REVEAL_EMAIL_TOGGLE_DESCRIPTOR)}
						</button>
					</span>
				}
				data-flx="user.account-security-tab.account-tab.account-tab-content.email-row"
			>
				{RuntimeConfig.emailsEnabled && (
					<Button
						variant="secondary"
						small={true}
						onClick={() =>
							ModalCommands.push(
								modal(() => (
									<EmailChangeModal
										user={user}
										data-flx="user.account-security-tab.account-tab.account-tab-content.email-change-modal"
									/>
								)),
							)
						}
						data-flx="user.account-security-tab.account-tab.account-tab-content.button.change-email"
					>
						<Trans>Change email</Trans>
					</Button>
				)}
			</AccountSecurityRow>
		) : (
			<AccountSecurityRow
				label={<Trans>Email address</Trans>}
				warning={<Trans>No email address set</Trans>}
				data-flx="user.account-security-tab.account-tab.account-tab-content.email-row--unclaimed"
			>
				<Button
					small={true}
					onClick={() => openClaimAccountModal()}
					data-flx="user.account-security-tab.account-tab.account-tab-content.button.add-email"
				>
					<Trans>Add email</Trans>
				</Button>
			</AccountSecurityRow>
		);
		const passwordRow = isClaimed ? (
			<AccountSecurityRow
				label={<Trans>Password</Trans>}
				description={
					user.passwordLastChangedAt ? (
						<Trans>Last changed: {DateUtils.getRelativeDateString(user.passwordLastChangedAt, i18n)}</Trans>
					) : (
						<Trans>Last changed: never</Trans>
					)
				}
				data-flx="user.account-security-tab.account-tab.account-tab-content.password-row"
			>
				<Button
					variant="secondary"
					small={true}
					onClick={() =>
						ModalCommands.push(
							modal(() => (
								<PasswordChangeModal data-flx="user.account-security-tab.account-tab.account-tab-content.password-change-modal" />
							)),
						)
					}
					data-flx="user.account-security-tab.account-tab.account-tab-content.button.change-password"
				>
					<Trans>Change password</Trans>
				</Button>
			</AccountSecurityRow>
		) : (
			<AccountSecurityRow
				label={<Trans>Password</Trans>}
				warning={<Trans>No password set</Trans>}
				data-flx="user.account-security-tab.account-tab.account-tab-content.password-row--unclaimed"
			>
				<Button
					small={true}
					onClick={() => openClaimAccountModal()}
					data-flx="user.account-security-tab.account-tab.account-tab-content.button.set-password"
				>
					<Trans>Set password</Trans>
				</Button>
			</AccountSecurityRow>
		);
		return (
			<>
				{!isClaimed && (
					<UnclaimedAccountAlert data-flx="user.account-security-tab.account-tab.account-tab-content.unclaimed-account-alert" />
				)}
				{usesUsernameSignIn && isClaimed && (
					<RecoveryKitReminderAlert
						user={user}
						data-flx="user.account-security-tab.account-tab.account-tab-content.recovery-kit-reminder-alert"
					/>
				)}
				<AccountSecurityCard
					aria-label={i18n._(SIGN_IN_METHODS_DESCRIPTOR)}
					data-flx="user.account-security-tab.account-tab.account-tab-content.rows"
				>
					{emailRow}
					{passwordRow}
					{showWalletLink && isClaimed && (
						<AccountSecurityRow
							label={walletCopy.label}
							description={walletCopy.description}
							warning={walletLinkError ? <span role="alert">{walletLinkError}</span> : null}
							data-flx="user.account-security-tab.account-tab.wallet-row"
						>
							<Button variant="secondary" small={true} submitting={linkingWallet} disabled={linkingWallet}
								onClick={linkWallet} data-flx="user.account-security-tab.account-tab.button.link-wallet">
								{walletCopy.button}
							</Button>
						</AccountSecurityRow>
					)}
					{usesUsernameSignIn && isClaimed && (
						<RecoveryKitRow
							user={user}
							data-flx="user.account-security-tab.account-tab.account-tab-content.recovery-kit-row"
						/>
					)}
				</AccountSecurityCard>
				{canResendVerificationEmail(user) && (
					<EmailVerificationAlert data-flx="user.account-security-tab.account-tab.account-tab-content.email-verification-alert" />
				)}
			</>
		);
	},
);
