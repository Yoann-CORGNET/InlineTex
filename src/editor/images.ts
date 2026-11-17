import * as path from 'node:path';
import * as vscode from 'vscode';
import { IMAGE_EXTENSIONS, imageDataUri, imageFileNames, imageSize, type ImageSize } from '../render/image';

/**
 * Larger pictures are not previewed: the data URI (base64 inside an SVG, itself
 * in base64) is sent to the renderer on every pass, cursor moves included.
 */
const MAX_IMAGE_BYTES = 1024 * 1024;

/** A picture found for an \includegraphics path. */
export interface LoadedImage {
  uri: vscode.Uri;
  dataUri: string;
  size: ImageSize;
}

/**
 * Pictures of \includegraphics, loaded asynchronously and kept until a picture
 * file changes on disk.
 */
export class ImageLoader implements vscode.Disposable {
  /** Pictures by base directories and path: the pending load, then its result. */
  private readonly images = new Map<string, Promise<LoadedImage | undefined> | LoadedImage | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * `onLoaded` fires when a picture needed by `doc` is ready; `onFilesChanged`
   * when picture files changed on disk and every picture was forgotten.
   */
  constructor(
    private readonly onLoaded: (doc: vscode.Uri) => void,
    onFilesChanged: () => void,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/*{${IMAGE_EXTENSIONS.join(',')}}`);
    // Debounced: a script regenerating plots writes many files in a row.
    const changed = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.images.clear();
        onFilesChanged();
      }, 300);
    };
    this.disposables.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
  }

  /**
   * The picture for an \includegraphics path, looked up like LaTeX does:
   * relative to the root document, then to `doc`. Undefined while it loads or
   * if there is none.
   */
  get(doc: vscode.TextDocument, root: vscode.Uri | undefined, ref: string): LoadedImage | undefined {
    const bases = [vscode.Uri.joinPath(doc.uri, '..')];
    if (root) {
      bases.unshift(vscode.Uri.joinPath(root, '..'));
    }
    const key = `${bases.map((b) => b.toString()).join('|')}|${ref}`;
    if (this.images.has(key)) {
      const known = this.images.get(key);
      return known instanceof Promise ? undefined : known;
    }
    const loading = findImage(bases, ref);
    this.images.set(key, loading);
    void loading.then((img) => {
      if (this.images.get(key) === loading) {
        this.images.set(key, img);
        if (img) {
          this.onLoaded(doc.uri);
        }
      }
    });
    return undefined;
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/** First displayable file for `ref` in `bases`, trying the extensions when none is given. */
async function findImage(bases: vscode.Uri[], ref: string): Promise<LoadedImage | undefined> {
  const names = imageFileNames(ref);
  for (const base of bases) {
    for (const name of names) {
      const uri = vscode.Uri.joinPath(base, name);
      const image = await loadImage(uri, path.posix.extname(name).toLowerCase());
      if (image) {
        return image;
      }
    }
  }
  return undefined;
}

async function loadImage(uri: vscode.Uri, ext: string): Promise<LoadedImage | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_IMAGE_BYTES) {
      return undefined;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    const size = imageSize(bytes, ext);
    return size ? { uri, dataUri: imageDataUri(bytes, ext), size } : undefined;
  } catch {
    return undefined;
  }
}
