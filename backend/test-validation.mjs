import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { validDraft, samePlan } from './worker.js';

const require = createRequire(import.meta.url);
const P = require('../placement-planner.js');
const plan = JSON.parse(readFileSync(new URL('../placement-plan.json', import.meta.url), 'utf8'));
const draft = P.exportDraft(P.create(plan));
assert(validDraft(draft));
assert(samePlan(draft, draft));

const wrongSignature = structuredClone(draft);
wrongSignature.signature = 'another plan';
assert(!samePlan(draft, wrongSignature));

const wrongSite = structuredClone(draft);
wrongSite.assignments[0][1] = '999,999';
assert(!samePlan(draft, wrongSite));

const duplicateLock = structuredClone(draft);
duplicateLock.locks = [draft.assignments[0][0], draft.assignments[0][0]];
assert(!validDraft(duplicateLock));

const unpairedLock = structuredClone(draft);
unpairedLock.pairs = [{ strike: draft.assignments[0][0], reserve: draft.assignments[1][0] }];
assert(!validDraft(unpairedLock));

console.log('Draft structure, plan identity, and pair validation passed');
