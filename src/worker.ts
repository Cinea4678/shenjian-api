/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
}

const API_LIMIT_PER_MINUTE = 15;

async function handle_get(index: string, env: Env): Promise<Response> {
	let object: R2Object | null;
	let objectList: string[] = (await env.KV_NAMESPACE.get('objlist', 'json')) ?? [];
	if (index === '随机') {
		object = await env.BUCKET.get(objectList[Math.floor(Math.random() * objectList.length)]);
	} else {
		object = await env.BUCKET.get(index + '.jpg');
	}
	if (object === null) {
		return new Response('Object Not Found', { status: 404 });
	} else {
		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set('etag', object.httpEtag);

		return new Response(object.body, {
			headers,
		});
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { pathname, searchParams } = new URL(request.url);

		if (pathname === '/get') {
			if (searchParams.has('index')) {
				const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';

				// 访问控制
				const count = parseInt((await env.KV_NAMESPACE.get(ip, { type: 'text' })) || '0');
				if (count > API_LIMIT_PER_MINUTE) {
					return new Response('Rate limit exceeded', { status: 429 });
				}
				await env.KV_NAMESPACE.put(ip, (count + 1).toString(), { expirationTtl: 60 });

				return handle_get(searchParams.get('index')!, env);
			} else {
				return new Response('Send index please.', { status: 400 });
			}
		} else if (pathname === '/update') {
			const options = {
				limit: 500,
				include: ['customMetadata', 'httpMetadata'],
			};

			const listed = await env.BUCKET.list();
			console.log(listed);

			let truncated = listed.truncated;
			let cursor = listed.truncated ? listed.cursor : undefined;

			while (truncated) {
				const next = await env.BUCKET.list({
					...options,
					cursor: cursor,
				});
				listed.objects.push(...next.objects);

				truncated = next.truncated;
				cursor = next.truncated ? next.cursor : undefined;
			}

			await env.KV_NAMESPACE.put(
				'objlist',
				JSON.stringify(listed.objects.filter((obj) => !obj.key.startsWith('list')).map((obj) => obj.key))
			);

			return new Response(`OK added ${listed.objects.length} objetcs`);
		}

		return new Response('Shenjian API');
	},
};
