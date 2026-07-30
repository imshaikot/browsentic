import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { describeElement, resolveTarget, targetSchema } from './dom';

export const attachFile = defineAction({
  name: 'page.attachFile',
  description: 'Attach a stored VoiceLink file (by id, from page.listFiles) to a file input on the page.',
  input: z.object({
    fileId: z.string().describe('Id of a stored file, taken from page.listFiles.'),
    target: targetSchema.describe('The file input (<input type="file">) to attach the file to.'),
    name: z.string().optional().describe('Internal: original filename. The extension fills this in.'),
    mime: z.string().optional().describe('Internal: file MIME type. The extension fills this in.'),
    content: z.string().optional().describe('Internal: base64 file bytes. The extension fills this in.'),
  }),
  execute({ target, name, mime, content }) {
    if (!content) {
      throw new ActionError('No file bytes were supplied — call with a valid fileId.', 'INVALID_INPUT');
    }
    const el = resolveTarget(target, { includeHidden: true });
    if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
      throw new ActionError(`<${el.tagName.toLowerCase()}> is not a file input`, 'INVALID_TARGET');
    }

    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const file = new File([bytes], name || 'file', { type: mime || 'application/octet-stream' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')!.set!.call(el, transfer.files);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { attached: true, name: file.name, size: bytes.length, mime: file.type, element: describeElement(el) };
  },
});
