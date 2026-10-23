import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Local .env takes precedence for the launcher; never print its contents.
if(existsSync(path.join(root,'.env')))Object.assign(process.env,parseEnv(readFileSync(path.join(root,'.env'),'utf8')));
if(!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length<12){console.error('Set ADMIN_PASSWORD (12+ characters) in .env before preview.');process.exit(1)}
mkdirSync(path.join(root,'.runtime'),{recursive:true});
const python=process.env.PYTHON_BIN||path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const env={...process.env,DATABASE_URL:process.env.DATABASE_URL||`sqlite:///${path.join(root,'.runtime','aeza.db')}`,DATA_PATH:path.join(root,'data/original/data.json')};
const migration=spawnSync(python,['-m','alembic','upgrade','head'],{cwd:path.join(root,'backend'),env,stdio:'inherit'});
if(migration.status!==0){console.error('Migration failed:',migration.error?.message||migration.signal||migration.status);process.exit(migration.status||1)}
const backend=spawn(python,['-m','uvicorn','app.main:production_app','--factory','--host','0.0.0.0','--port','8000'],{cwd:path.join(root,'backend'),env,stdio:'inherit'});
const frontend=spawn(process.platform==='win32'?'npm.cmd':'npm',['run','dev'],{cwd:path.join(root,'frontend'),env,stdio:'inherit',shell:process.platform==='win32'});
backend.on('error',e=>console.error('Backend launch error:',e.message));frontend.on('error',e=>console.error('Frontend launch error:',e.message));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{backend.kill();frontend.kill();process.exit(0)});
backend.on('exit',(code,signal)=>{console.error('Backend stopped:',code,signal);frontend.kill();process.exit(code||0)});frontend.on('exit',(code,signal)=>{console.error('Frontend stopped:',code,signal);backend.kill();process.exit(code||0)});
