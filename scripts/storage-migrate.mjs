#!/usr/bin/env node
import {runStorage} from './instance-data/cli.mjs';
runStorage().catch(error => { console.error(error.message); process.exitCode = 1; });
