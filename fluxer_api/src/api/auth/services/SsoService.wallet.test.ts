// SPDX-License-Identifier: AGPL-3.0-or-later

import {SsoService} from '@app/api/auth/services/SsoService';
import {AccountIdentityModes, type AccountIdentityMode} from '@fluxer/constants/src/AccountIdentityConstants';
import {createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT} from 'jose';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const ISSUER = 'https://auth.chat.daoi.ai';
const SUBJECT = '04d81bcc-ed12-43cb-8d03-1a8cf4dfd905';
const NONCE = 'expected-wallet-login-nonce';
const CLIENT_ID = 'daoi-fluxer';
const WALLET_ADDRESS = `0x${'Aa'.repeat(20)}`;

interface Claims {
	email: string | null;
	emailVerified: boolean;
	trustedWallet: boolean;
	walletAddress?: string;
	name?: string | null;
	sub: string;
}

interface SsoTestAccess {
	startLogin(): Promise<{authorization_url: string}>;
	startLink(options: {user: {id: bigint}; redirectTo?: string}): Promise<{authorization_url: string}>;
	completeLogin(options: {code: string; state: string; request: Request; requestCache: unknown}): Promise<unknown>;
	completeLink(options: {user: unknown; code: string; state: string}): Promise<unknown>;
	exchangeCode(options: unknown): Promise<{id_token: string}>;
	requireReadyConfig(): Promise<unknown>;
	resolveClaims(tokens: {id_token?: string; access_token?: string}, config: unknown, nonce: string): Promise<Claims>;
	resolveUserFromClaims(claims: Claims, config: unknown, cache: unknown): Promise<unknown>;
	getOrCreateJwks(url: string): Promise<ReturnType<typeof createLocalJWKSet>>;
	fetchUserInfo(url: string, token: string): Promise<Record<string, unknown>>;
	bindSsoIdentity(user: unknown, sub: string, config: unknown): Promise<unknown>;
}

describe('DAOI wallet SSO', () => {
	let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
	let jwks: ReturnType<typeof createLocalJWKSet>;
	let mode: AccountIdentityMode;
	let service: SsoTestAccess;
	let users: {findUnique: ReturnType<typeof vi.fn>; findByEmail: ReturnType<typeof vi.fn>};
	let findUserId: ReturnType<typeof vi.fn>;
	let cache: {set: ReturnType<typeof vi.fn>; getAndDelete: ReturnType<typeof vi.fn>};
	let setWalletAddress: ReturnType<typeof vi.fn>;

	const config = (issuer = ISSUER) => ({
		issuer,
		issuerForVerification: issuer,
		providerId: issuer,
		jwksUrl: `${issuer}/jwks`,
		clientId: CLIENT_ID,
		authorizationUrl: `${issuer}/auth`,
		redirectUri: 'https://chat.daoi.ai/auth/sso/callback',
		scope: 'openid profile',
		userInfoUrl: null,
		allowedEmailDomains: [],
		isTestProvider: false,
		autoProvision: false,
	});

	async function sign(
		claims: JWTPayload = {},
		{issuer = ISSUER, nonce = NONCE, audience = CLIENT_ID}: {issuer?: string; nonce?: string | null; audience?: string} = {},
	): Promise<string> {
		return new SignJWT({...claims, ...(nonce === null ? {} : {nonce})})
			.setProtectedHeader({alg: 'RS256', kid: 'wallet-sso-test'})
			.setIssuer(issuer)
			.setAudience(audience)
			.setSubject(typeof claims.sub === 'string' ? claims.sub : SUBJECT)
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(privateKey);
	}

	beforeAll(async () => {
		const pair = await generateKeyPair('RS256');
		privateKey = pair.privateKey;
		jwks = createLocalJWKSet({keys: [{...(await exportJWK(pair.publicKey)), kid: 'wallet-sso-test', alg: 'RS256'}]});
	});

	beforeEach(() => {
		mode = AccountIdentityModes.USERNAME;
		users = {findUnique: vi.fn(), findByEmail: vi.fn()};
		findUserId = vi.fn().mockResolvedValue(null);
		cache = {set: vi.fn(), getAndDelete: vi.fn()};
		setWalletAddress = vi.fn().mockResolvedValue(true);
		service = Object.assign(Object.create(SsoService.prototype), {
			apiContext: {request: {}, services: {users, cache}},
			instanceConfigRepository: {getAccountIdentity: async () => ({mode})},
			ssoIdentityRepository: {findUserId, setWalletAddress},
		}) as SsoTestAccess;
		vi.spyOn(service, 'getOrCreateJwks').mockResolvedValue(jwks);
	});

	it('requests a new wallet login without changing other issuers', async () => {
		const ready = vi.spyOn(service, 'requireReadyConfig');
		ready.mockResolvedValue(config());
		const walletLogin = await service.startLogin();
		expect(new URL(walletLogin.authorization_url).searchParams.get('prompt')).toBe('login');
		ready.mockResolvedValue(config('https://other.example.com'));
		const otherLogin = await service.startLogin();
		expect(new URL(otherLogin.authorization_url).searchParams.get('prompt')).toBeNull();
	});

	it('accepts a verified DAOI UUID without email and prefers the signed username', async () => {
		const token = await sign({preferred_username: 'daoi_wallet', name: 'Other name'});
		await expect(service.resolveClaims({id_token: token}, config(), NONCE)).resolves.toEqual({
			email: null,
			emailVerified: false,
			trustedWallet: true,
			walletAddress: undefined,
			name: 'daoi_wallet',
			sub: SUBJECT,
		});
	});

	it('reads the wallet profile only from userinfo bound to the verified ID-token subject', async () => {
		vi.spyOn(service, 'fetchUserInfo').mockResolvedValue({
			sub: SUBJECT,
			preferred_username: 'daoi_profile',
			wallet_address: WALLET_ADDRESS,
		});
		await expect(
			service.resolveClaims(
				{id_token: await sign(), access_token: 'userinfo'},
				{...config(), userInfoUrl: `${ISSUER}/me`},
				NONCE,
			),
		).resolves.toMatchObject({name: 'daoi_profile', walletAddress: WALLET_ADDRESS.toLowerCase()});
		await expect(
			service.resolveClaims({id_token: await sign({wallet_address: 'invalid'})}, config(), NONCE),
		).rejects.toThrow();
	});

	it('keeps email mandatory outside username mode', async () => {
		mode = AccountIdentityModes.EMAIL;
		await expect(service.resolveClaims({id_token: await sign()}, config(), NONCE)).rejects.toThrow();
	});

	it('keeps email mandatory for other verified issuers', async () => {
		const issuer = 'https://other.example.com';
		await expect(
			service.resolveClaims({id_token: await sign({}, {issuer})}, config(issuer), NONCE),
		).rejects.toThrow();
	});

	it('rejects a non-UUID DAOI subject', async () => {
		await expect(service.resolveClaims({id_token: await sign({sub: 'wallet-address'})}, config(), NONCE)).rejects.toThrow();
	});

	it('does not grant the wallet exception from userinfo alone', async () => {
		vi.spyOn(service, 'fetchUserInfo').mockResolvedValue({sub: SUBJECT, preferred_username: 'daoi_wallet'});
		await expect(
			service.resolveClaims({access_token: 'userinfo-only'}, {...config(), userInfoUrl: `${ISSUER}/me`}, NONCE),
		).rejects.toThrow();
	});

	it('preserves the ID-token/userinfo subject match requirement', async () => {
		vi.spyOn(service, 'fetchUserInfo').mockResolvedValue({sub: '04d81bcc-ed12-43cb-8d03-1a8cf4dfd906'});
		await expect(
			service.resolveClaims(
				{id_token: await sign(), access_token: 'userinfo'},
				{...config(), userInfoUrl: `${ISSUER}/me`},
				NONCE,
			),
		).rejects.toThrow();
	});

	it.each([null, 'wrong-nonce'])('rejects a missing or incorrect ID-token nonce (%s)', async (nonce) => {
		await expect(service.resolveClaims({id_token: await sign({}, {nonce})}, config(), NONCE)).rejects.toThrow();
	});

	it('preserves ID-token issuer and audience verification', async () => {
		for (const options of [{issuer: 'https://other.example.com'}, {audience: 'another-client'}]) {
			await expect(service.resolveClaims({id_token: await sign({}, options)}, config(), NONCE)).rejects.toThrow();
		}
	});

	it('retains verified-email SSO behavior for ordinary providers', async () => {
		const issuer = 'https://other.example.com';
		const claims = {email: 'user@example.com', email_verified: true, name: 'Email User'};
		await expect(
			service.resolveClaims({id_token: await sign(claims, {issuer})}, config(issuer), NONCE),
		).resolves.toMatchObject({email: claims.email, emailVerified: true, trustedWallet: false});
		await expect(
			service.resolveClaims({id_token: await sign({...claims, email_verified: false}, {issuer})}, config(issuer), NONCE),
		).rejects.toThrow();
	});

	it('resolves an existing wallet only by the stable issuer/subject mapping', async () => {
		const claims = await service.resolveClaims({id_token: await sign()}, config(), NONCE);
		const user = {id: 123n};
		findUserId.mockResolvedValue(user.id);
		users.findUnique.mockResolvedValue(user);
		const bind = vi.spyOn(service, 'bindSsoIdentity').mockResolvedValue(user);
		await expect(service.resolveUserFromClaims(claims, config(), {})).resolves.toBe(user);
		expect(findUserId).toHaveBeenCalledWith(ISSUER, SUBJECT);
		expect(bind).toHaveBeenCalledWith(user, SUBJECT, config());
		expect(users.findByEmail).not.toHaveBeenCalled();
	});

	it('never auto-links an unclaimed wallet through an email address', async () => {
		const claims = await service.resolveClaims({id_token: await sign({email: 'existing@example.com'})}, config(), NONCE);
		await expect(service.resolveUserFromClaims(claims, config(), {})).rejects.toThrow();
		expect(findUserId).toHaveBeenCalledWith(ISSUER, SUBJECT);
		expect(users.findByEmail).not.toHaveBeenCalled();
	});

	it('creates link state only for the authenticated server-side target', async () => {
		vi.spyOn(service, 'requireReadyConfig').mockResolvedValue(config());
		await service.startLink({user: {id: 123n}, redirectTo: '/project-community?id=7'});
		expect(cache.set.mock.calls[0][1]).toMatchObject({mode: 'link', linkTargetUserId: '123'});
	});

	it('rejects wallet linking for other providers or non-username instances', async () => {
		const ready = vi.spyOn(service, 'requireReadyConfig');
		ready.mockResolvedValue(config('https://other.example.com'));
		await expect(service.startLink({user: {id: 123n}})).rejects.toThrow();
		ready.mockResolvedValue(config());
		mode = AccountIdentityModes.EMAIL;
		await expect(service.startLink({user: {id: 123n}})).rejects.toThrow();
		expect(cache.set).not.toHaveBeenCalled();
	});

	it('does not process link state through the ordinary login completion', async () => {
		vi.spyOn(service, 'requireReadyConfig').mockResolvedValue(config());
		cache.getAndDelete.mockResolvedValue({mode: 'link', linkTargetUserId: '123'});
		const exchange = vi.spyOn(service, 'exchangeCode');
		await expect(
			service.completeLogin({code: 'code', state: 'state', request: new Request(ISSUER), requestCache: {}}),
		).rejects.toThrow();
		expect(exchange).not.toHaveBeenCalled();
	});

	it('requires the same current user that initiated the link', async () => {
		vi.spyOn(service, 'requireReadyConfig').mockResolvedValue(config());
		cache.getAndDelete.mockResolvedValue({mode: 'link', linkTargetUserId: '123'});
		const exchange = vi.spyOn(service, 'exchangeCode');
		await expect(service.completeLink({user: {id: 456n}, code: 'code', state: 'state'})).rejects.toThrow();
		expect(exchange).not.toHaveBeenCalled();
	});

	it('links a verified wallet to the existing user without issuing a session or changing profile fields', async () => {
		vi.spyOn(service, 'requireReadyConfig').mockResolvedValue(config());
		cache.getAndDelete.mockResolvedValue({
			mode: 'link', linkTargetUserId: '123', nonce: NONCE, codeVerifier: 'verifier', redirectTo: '/project-community?id=7',
		});
		vi.spyOn(service, 'exchangeCode').mockResolvedValue({id_token: await sign({wallet_address: WALLET_ADDRESS})});
		const user = {id: 123n, username: 'existing_user', passwordHash: 'existing_hash'};
		const bind = vi.spyOn(service, 'bindSsoIdentity').mockResolvedValue(user);
		await expect(service.completeLink({user, code: 'code', state: 'state'})).resolves.toEqual({
			linked: true, redirect_to: '/project-community?id=7',
		});
		expect(bind).toHaveBeenCalledWith(user, SUBJECT, config());
		expect(setWalletAddress).toHaveBeenCalledWith({
			providerId: ISSUER, subject: SUBJECT, userId: 123n, walletAddress: WALLET_ADDRESS.toLowerCase(),
		});
		expect(user).toEqual({id: 123n, username: 'existing_user', passwordHash: 'existing_hash'});
		expect(users.findByEmail).not.toHaveBeenCalled();
	});

	it('does not transfer an identity already owned by another account', async () => {
		vi.spyOn(service, 'requireReadyConfig').mockResolvedValue(config());
		cache.getAndDelete.mockResolvedValue({mode: 'link', linkTargetUserId: '123', nonce: NONCE, codeVerifier: 'verifier'});
		vi.spyOn(service, 'exchangeCode').mockResolvedValue({id_token: await sign({wallet_address: WALLET_ADDRESS})});
		vi.spyOn(service, 'bindSsoIdentity').mockRejectedValue(new Error('SSO_IDENTITY_MISMATCH'));
		await expect(service.completeLink({user: {id: 123n}, code: 'code', state: 'state'})).rejects.toThrow('SSO_IDENTITY_MISMATCH');
		expect(setWalletAddress).not.toHaveBeenCalled();
	});
});
