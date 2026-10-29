// Records a new APK release for the in-app updater. Called by the EAS release workflow, not by
// users: deploy with verify_jwt off and rely on the shared secret below.

import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = { 'Content-Type': 'application/json' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

/**
 * The workflow only has a build id (the build job exposes no artifact URL and `eas` isn't
 * available in its steps), so the APK URL is looked up through the Expo GraphQL API.
 * Needs the EXPO_TOKEN secret (an Expo access token).
 */
async function resolveApkUrl(buildId: string): Promise<string | null> {
  const token = Deno.env.get('EXPO_TOKEN');
  if (!token) throw new Error('EXPO_TOKEN is not configured');

  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: 'query($id: ID!){ builds { byId(buildId: $id){ artifacts { applicationArchiveUrl buildUrl } } } }',
      variables: { id: buildId },
    }),
  });
  const body = await res.json();
  if (body?.errors?.length) throw new Error(`Expo API error: ${body.errors[0]?.message ?? 'unknown'}`);
  const artifacts = body?.data?.builds?.byId?.artifacts;
  return artifacts?.applicationArchiveUrl ?? artifacts?.buildUrl ?? null;
}

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get('x-publish-secret');
    if (!secret || secret !== Deno.env.get('PUBLISH_RELEASE_SECRET')) return json({ error: 'Unauthorized' }, 401);

    const { version, apk_url: providedUrl, build_id, release_notes } = await req.json();
    if (!version || (!providedUrl && !build_id)) return json({ error: 'Missing: version and (apk_url or build_id)' }, 400);

    const apk_url = providedUrl ?? (await resolveApkUrl(build_id));
    if (!apk_url) return json({ error: `Could not resolve APK URL for build ${build_id}` }, 502);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Re-running a tag's workflow must not publish twice.
    const { data: existing } = await admin.from('app_releases').select('id').eq('version', version).maybeSingle();
    if (existing) return json({ status: 'already_published', version });

    const { error } = await admin.from('app_releases').insert({ version, apk_url, release_notes: release_notes ?? null });
    if (error) throw error;
    return json({ status: 'published', version });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
