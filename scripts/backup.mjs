#!/usr/bin/env node
import {runBackup} from './instance-data/cli.mjs';
runBackup().catch(error => { console.error(error.message); process.exitCode = 1; });
