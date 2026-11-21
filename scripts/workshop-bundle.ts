/** 수집 Lambda를 한 파일로 묶는다. @aws-sdk/*는 Lambda Node.js 22 런타임에 들어 있어 묶지 않는다 */
import { build } from 'esbuild'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export async function bundleCollectLambda(outfile: string): Promise<void> {
  await build({
    entryPoints: [join(ROOT, 'infra', 'lambda', 'collect.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: ['@aws-sdk/*'],
    legalComments: 'none',
    logLevel: 'silent',
  })
}
