import assert from "node:assert/strict";
import test from "node:test";
import {
  endpoints,
  itemTypeByCode,
  messageIdFields,
  protocolDefaults,
  timestampFields
} from "../../src/core/protocol-constants.js";
import { generateClientId, makeWechatUin } from "../../src/core/ilink-client.js";

test("M0 constants match documented defaults", () => {
  assert.equal(protocolDefaults.channelVersion, "0.1.0");
  assert.equal(protocolDefaults.qrBotType, 3);
  assert.equal(endpoints.getUpdates, "/ilink/bot/getupdates");
  assert.equal(itemTypeByCode[1], "text");
  assert.equal(itemTypeByCode[3], "image");
  assert.equal(itemTypeByCode[4], "file");
  assert.equal(messageIdFields[0], "msg_id");
  assert.equal(timestampFields[0], "timestamp");
});

test("generates iLink request helper values", () => {
  assert.match(makeWechatUin(), /^[A-Za-z0-9+/]+=*$/);
  assert.match(generateClientId(1715000000000), /^wxb-1715000000000-[a-f0-9]{8}$/);
});
