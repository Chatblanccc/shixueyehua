import { spawnSync } from 'node:child_process';

const command = process.argv[2];
if (!command || !['open', 'build-npm'].includes(command))
  throw new Error('仅支持 open/build-npm。');
const cli =
  process.env.WECHAT_DEVTOOLS_CLI ?? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const result = spawnSync(cli, [command, '--project', process.cwd()], { encoding: 'utf8' });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
// DevTools CLI can report an API error with exit code zero.
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
if (result.status !== 0 || /\[error\]|✖/.test(output)) process.exitCode = 1;
