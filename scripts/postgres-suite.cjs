// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {spawnSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
if(!process.env.LINKPAGE_TEST_POSTGRES_URL){console.error('Set LINKPAGE_TEST_POSTGRES_URL to a PostgreSQL test database. Each test file creates and removes its own schema.');process.exit(1);}
const files=fs.readdirSync(path.join(__dirname,'../tests')).filter(name=>name.endsWith('.test.js')&&!['migrations.test.js','lockfiles.test.js'].includes(name));
const result=spawnSync(process.execPath,['--test','--test-concurrency=4',...files.map(name=>'tests/'+name)],{cwd:path.join(__dirname,'..'),env:process.env,stdio:'inherit'});process.exitCode=result.status??1;
