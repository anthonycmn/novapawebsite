// A campaign's audience name decides who gets the email, and the sender used
// to treat a name it did not recognise as "every family in the register". One
// missing "seg_" prefix was the difference between 21 recipients and 789, and
// nothing anywhere said so. Three newsletter drafts written for Resend sat in
// that table for nine days, each naming a different audience, all three of
// which would have resolved to the same 789 families.
//
// This pins the rule: a name is a batch, a segment, or one of three spellings
// of "everyone" that someone chose on purpose. Anything else is unknown, and
// unknown stops the send.

import assert from 'node:assert/strict';
import { audienceKind, hasBroadcastSyntax, WIDE_AUDIENCES } from '../netlify/functions/reg-campaign.mjs';

let failures = 0;
function check(label, fn) {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { failures++; console.log('FAIL  ' + label + '\n      ' + e.message); }
}

check('the Constant Contact batches resolve to the import', () => {
  for (const n of ['cc_batch_1', 'cc_batch_2', 'cc_batch_3', 'cc_batch_4']) {
    assert.equal(audienceKind(n), 'cc_batch', n);
  }
});

check('every seg_ name resolves to a segment', () => {
  for (const n of ['seg_laborday_camps', 'seg_ref2_httyd', 'seg_frozen_jr_912', 'seg_classes_x_0821']) {
    assert.equal(audienceKind(n), 'segment', n);
  }
});

check('the three wide names are allowed, and only those three', () => {
  assert.equal(audienceKind('non_buyers_2027'), 'wide');
  assert.equal(audienceKind('buyers_2027'), 'wide');
  assert.equal(audienceKind('all_families'), 'wide');
  assert.equal(WIDE_AUDIENCES.size, 3);
});

check('a segment name with the prefix missing is unknown, not everyone', () => {
  assert.equal(audienceKind('ref2_httyd'), 'unknown');
  assert.equal(audienceKind('laborday_camps'), 'unknown');
});

check('the three Sep 14 newsletter names are unknown', () => {
  for (const n of ['newsletter_families_20260909',
                   'newsletter_prospects_20260909',
                   'newsletter_ticket_buyers_20260909']) {
    assert.equal(audienceKind(n), 'unknown', n);
  }
});

check('nothing, an empty string and junk are unknown', () => {
  assert.equal(audienceKind(undefined), 'unknown');
  assert.equal(audienceKind(null), 'unknown');
  assert.equal(audienceKind(''), 'unknown');
  assert.equal(audienceKind('seg_'), 'unknown');
  assert.equal(audienceKind('cc_batch_'), 'unknown');
  assert.equal(audienceKind('SEG_LABORDAY_CAMPS'), 'unknown');
  assert.equal(audienceKind('seg_laborday camps'), 'unknown');
});

check('a Resend broadcast body is refused', () => {
  assert.equal(hasBroadcastSyntax('Hi {{{contact.first_name|there}}},'), true);
  assert.equal(hasBroadcastSyntax('footer {{{RESEND_UNSUBSCRIBE_URL}}}'), true);
});

check('a body written for this sender is accepted', () => {
  assert.equal(hasBroadcastSyntax('Hi {first_name}, [CLAIM A SPOT](https://novapa.org/register/)'), false);
  assert.equal(hasBroadcastSyntax('your link: {ref_link}'), false);
  assert.equal(hasBroadcastSyntax(''), false);
  assert.equal(hasBroadcastSyntax(undefined), false);
});

if (failures) { console.log('\n' + failures + ' failing'); process.exit(1); }
console.log('\nall passing');
