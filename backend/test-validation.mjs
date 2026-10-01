import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { validDraft, samePlan, validPlan, draftFitsPlan, planSignature } from './worker.js';

const require = createRequire(import.meta.url);
const P = require('../placement-planner.js');
const plan = JSON.parse(readFileSync(new URL('../placement-plan.json', import.meta.url), 'utf8'));
const draft = P.exportDraft(P.create(plan));
assert(validDraft(draft));
assert(samePlan(draft, draft));
assert(validPlan(plan));
assert.equal(planSignature(plan), draft.signature);
assert(draftFitsPlan(draft, plan));
const versioned = { ...plan, planId: 'atlas-refresh-test' };
const refreshed = P.exportDraft(P.create(versioned));
assert(draftFitsPlan(refreshed, versioned));
assert(!draftFitsPlan(draft, versioned));
const invalidPair = structuredClone(refreshed);
const mudIds = versioned.placements.filter(p => p.zone === 'mud').map(p => p.id);
invalidPair.pairs = [{ strike: mudIds[0], reserve: mudIds[1] }];
invalidPair.locks = mudIds.slice(0, 2);
assert(!draftFitsPlan(invalidPair, versioned));

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
