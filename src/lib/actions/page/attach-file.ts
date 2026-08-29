import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { describeElement, resolveTarget, targetSchema } from './dom';

export const attachFile = defineAction({
  name: 'page.attachFile',
  description:
    'Attach a file to a file input on the page: either one the user stored in Browsentic (fileId, from page.listFiles) or one you captured off another page (downloadId, from page.captureDownload). The second closes the loop — download here, upload there — without the bytes ever passing through you.',
  input: z.object({
    fileId: z.string().optional().describe('Id of a stored file, taken from page.listFiles.'),
    downloadId: z
      .string()
      .optional()
      .describe('Id of a captured download, taken from page.captureDownload or page.listDownloads.'),
    target: targetSchema.describe('The file input (<input type="file">) to attach the file to.'),
    name: z.string().optional().describe('Internal: original filename. Browsentic fills this in.'),
    mime: z.string().optional().describe('Internal: file MIME type. Browsentic fills this in.'),
    content: z.string().optional().describe('Internal: base64 file bytes. Browsentic fills this in.'),
  }),
  execute({ target, name, mime, content }) {
    if (!content) {
      throw new ActionError('No file bytes were supplied — call with a valid fileId or downloadId.', 'INVALID_INPUT');
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
