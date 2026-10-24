export function assistantSessionMarkdown(session) {
  const title = String(session?.title || 'Conversation sans titre').replace(/\s+/g, ' ').trim();
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const body = messages.map((message) => {
    const role = message.role === 'assistant' ? 'Assistant' : 'Vous';
    const command = message.command ? ` (/${message.command})` : '';
    return `### ${role}${command}\n\n${String(message.content || '')}`;
  });
  return `# ${title}\n\n${body.join('\n\n')}\n`;
}

export function assistantSessionsMarkdown(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .map(assistantSessionMarkdown)
    .join('\n---\n\n');
}

export function downloadAssistantMarkdown(sessions, filename = 'orbit-conversations.md') {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    throw new Error('Export de conversation indisponible dans cet environnement.');
  }
  const content = assistantSessionsMarkdown(sessions);
  if (!content.trim()) throw new Error('Aucune conversation à exporter.');
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
