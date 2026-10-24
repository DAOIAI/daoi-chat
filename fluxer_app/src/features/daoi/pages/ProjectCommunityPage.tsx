// SPDX-License-Identifier: AGPL-3.0-or-later

import {Routes} from '@app/app/Routes';
import styles from '@app/features/app/components/pages/NotFoundPage.module.css';
import * as RouterUtils from '@app/features/navigation/utils/RouterUtils';
import {useLocation} from '@app/features/platform/components/router/RouterReact';
import {http} from '@app/features/platform/transport/RestTransport';
import {HttpError} from '@app/features/platform/types/EndpointError';
import {Button} from '@app/features/ui/button/Button';
import {useFluxerDocumentTitle} from '@app/features/window/hooks/useFluxerDocumentTitle';
import {useLingui} from '@lingui/react/macro';
import {useEffect, useMemo, useState} from 'react';

const COPY = {
	'zh-CN': {
		title: '项目社区',
		loading: '正在进入项目社区…',
		unopened: '创建者尚未开通这个项目的社区，请稍后再试。',
		invalid: '项目链接不完整，请从 DAOI 项目详情重新进入。',
		error: '暂时无法进入项目社区，请重试。',
		retry: '重试',
		back: '返回聊天',
	},
	'zh-TW': {
		title: '項目社區',
		loading: '正在進入項目社區…',
		unopened: '創建者尚未開通這個項目的社區，請稍後再試。',
		invalid: '項目連結不完整，請從 DAOI 項目詳情重新進入。',
		error: '暫時無法進入項目社區，請重試。',
		retry: '重試',
		back: '返回聊天',
	},
	'ko-KR': {
		title: '프로젝트 커뮤니티',
		loading: '프로젝트 커뮤니티에 입장 중…',
		unopened: '프로젝트 생성자가 아직 커뮤니티를 개설하지 않았습니다. 나중에 다시 시도해 주세요.',
		invalid: '프로젝트 링크가 올바르지 않습니다. DAOI 프로젝트 페이지에서 다시 열어 주세요.',
		error: '커뮤니티에 입장할 수 없습니다. 다시 시도해 주세요.',
		retry: '다시 시도',
		back: '채팅으로 돌아가기',
	},
	'vi-VN': {
		title: 'Cộng đồng dự án',
		loading: 'Đang vào cộng đồng dự án…',
		unopened: 'Người tạo dự án chưa mở cộng đồng. Vui lòng thử lại sau.',
		invalid: 'Liên kết dự án chưa đầy đủ. Vui lòng mở lại từ trang dự án DAOI.',
		error: 'Chưa thể vào cộng đồng. Vui lòng thử lại.',
		retry: 'Thử lại',
		back: 'Về trò chuyện',
	},
	'en-US': {
		title: 'Project community',
		loading: 'Opening the project community…',
		unopened: 'The project creator has not opened this community yet. Please try again later.',
		invalid: 'This project link is incomplete. Open the community from the DAOI project page.',
		error: 'The community could not be opened. Please try again.',
		retry: 'Try again',
		back: 'Back to chat',
	},
};

interface ProjectReference {
	chain_id: number;
	factory_address: string;
	project_id: string;
}

function projectReference(search: string): ProjectReference | null {
	const params = new URLSearchParams(search);
	const chainId = Number(params.get('chainId'));
	const factory = params.get('factory') ?? '';
	const id = params.get('id') ?? '';
	if (
		!Number.isSafeInteger(chainId) ||
		chainId < 1 ||
		!/^0x[\da-fA-F]{40}$/.test(factory) ||
		/^0x0{40}$/i.test(factory) ||
		!/^(?:(?:curve|rwa-presale|rwa-curve):)?\d+$/.test(id)
	) {
		return null;
	}
	return {chain_id: chainId, factory_address: factory, project_id: id};
}

export function ProjectCommunityPage() {
	const {i18n} = useLingui();
	const copy = COPY[i18n.locale as keyof typeof COPY] ?? COPY['en-US'];
	const location = useLocation();
	const reference = useMemo(() => projectReference(location.search), [location.search]);
	const [attempt, setAttempt] = useState(0);
	const [status, setStatus] = useState<'loading' | 'unopened' | 'invalid' | 'error'>('loading');
	useFluxerDocumentTitle(copy.title);

	useEffect(() => {
		if (reference === null) {
			setStatus('invalid');
			return;
		}
		let active = true;
		const controller = new AbortController();
		setStatus('loading');
		void http
			.post<{guild_id: string; channel_id: string}>('/daoi/project-community/enter', {
				body: reference,
				signal: controller.signal,
			})
			.then((response) => {
				if (!active) return;
				const {guild_id: guildId, channel_id: channelId} = response.body;
				if (!/^\d+$/.test(guildId) || !/^\d+$/.test(channelId)) throw new Error('Invalid community destination');
				RouterUtils.replaceWith(Routes.guildChannel(guildId, channelId));
			})
			.catch((error: unknown) => {
				if (active) setStatus(error instanceof HttpError && error.status === 409 ? 'unopened' : 'error');
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [reference, attempt]);

	return (
		<div className={styles.container} aria-busy={status === 'loading'} data-flx="daoi.project-community.container">
			<div className={styles.content} data-flx="daoi.project-community.content">
				<h1 className={styles.title} data-flx="daoi.project-community.title">
					{copy.title}
				</h1>
				<p
					className={styles.description}
					role={status === 'error' || status === 'invalid' ? 'alert' : 'status'}
					data-flx="daoi.project-community.status"
				>
					{copy[status]}
				</p>
			</div>
			<div className={styles.actions} data-flx="daoi.project-community.actions">
				{status === 'error' || status === 'unopened' ? (
					<Button onClick={() => setAttempt((value) => value + 1)} data-flx="daoi.project-community.retry">
						{copy.retry}
					</Button>
				) : null}
				<Button
					variant="secondary"
					onClick={() => RouterUtils.replaceWith(Routes.ME)}
					data-flx="daoi.project-community.back"
				>
					{copy.back}
				</Button>
			</div>
		</div>
	);
}
