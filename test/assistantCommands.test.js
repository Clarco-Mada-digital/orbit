import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_COMMANDS,
  ASSISTANT_COMMAND_CATEGORIES,
  filterAssistantCommands,
  getAssistantCommand,
  parseAssistantCommand,
} from '../src/lib/assistantCommands.js';
import { createAssistantMessages } from '../src/lib/assistantPrompts.js';
import { ASSISTANT_AGENTS, getAssistantAgent, groupAssistantAgents } from '../src/lib/assistantAgents.js';

test('slash commands have unique ids and a known category', () => {
  const ids = ASSISTANT_COMMANDS.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('fix'));
  assert.ok(ids.includes('summarize'));
  for (const command of ASSISTANT_COMMANDS) {
    assert.match(command.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(ASSISTANT_COMMAND_CATEGORIES.some((category) => category.id === command.category));
    assert.ok(command.instruction.length > 20);
  }
});

test('parses a leading known command and leaves unknown slashes untouched', () => {
  assert.equal(getAssistantCommand('FIX').id, 'fix');
  assert.deepEqual(parseAssistantCommand('/fix Bonjour.'), {
    command: getAssistantCommand('fix'),
    text: 'Bonjour.',
  });
  assert.equal(parseAssistantCommand('/translate\nHello world').text, 'Hello world');
  assert.equal(parseAssistantCommand('/fix').text, '');

  const unknown = parseAssistantCommand('/inconnue Bonjour');
  assert.equal(unknown.command, null);
  assert.equal(unknown.text, '/inconnue Bonjour');
  assert.equal(parseAssistantCommand('/').command, null);
  assert.equal(parseAssistantCommand('Bonjour /fix').command, null);
});

test('filters commands by id and by accented or plain keywords', () => {
  assert.deepEqual(filterAssistantCommands('fix').map((command) => command.id), ['fix']);
  assert.deepEqual(filterAssistantCommands('corr').map((command) => command.id), ['fix']);
  assert.ok(filterAssistantCommands('tradu').some((command) => command.id === 'translate'));
  assert.ok(filterAssistantCommands('idée').some((command) => command.id === 'ideas'));
  assert.equal(filterAssistantCommands('').length, ASSISTANT_COMMANDS.length);
  assert.deepEqual(filterAssistantCommands('zzz'), []);
});

test('chat prompts carry the command instruction, other modes ignore it', () => {
  const chat = createAssistantMessages({ mode: 'chat', text: 'Bonjour.', chatCommandId: 'fix' });
  assert.match(chat[0].content, /selected the \/fix command/);
  assert.match(chat[0].content, /Correct spelling/);

  const proofread = createAssistantMessages({
    mode: 'correct',
    text: 'Bonjour.',
    chatCommandId: 'fix',
  });

  assert.doesNotMatch(proofread[0].content, /selected the/);

  const unknown = createAssistantMessages({
    mode: 'chat',
    text: 'Bonjour.',
    chatCommandId: 'unknown',
  });
  assert.doesNotMatch(unknown[0].content, /selected the/);
});

test('agent commands are scoped to the selected agent', () => {
  const writer = getAssistantAgent('writer');
  const developer = getAssistantAgent('developer');
  assert.ok(parseAssistantCommand('/fix typo', writer.commands).command);
  assert.equal(parseAssistantCommand('/refactor code', writer.commands).command, null);
  assert.ok(parseAssistantCommand('/refactor code', developer.commands).command);
  assert.equal(filterAssistantCommands('', writer.commands).length, 3);
  assert.deepEqual(
    groupAssistantAgents().map((group) => group.agents.map((agent) => agent.id)).flat().sort(),
    ASSISTANT_AGENTS.map((agent) => agent.id).sort()
  );
});

test('agent prompt uses the chosen persona and its own slash-command instruction', () => {
  const messages = createAssistantMessages({
    mode: 'chat',
    text: 'const value = 1;',
    agentId: 'developer',
    chatCommandId: 'refactor',
  });
  assert.match(messages[0].content, /software engineering assistant/);
  assert.match(messages[0].content, /user selected the \/refactor command/);
  assert.doesNotMatch(messages[0].content, /email/);
});
