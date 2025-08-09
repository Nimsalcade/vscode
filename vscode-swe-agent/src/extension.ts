import * as vscode from 'vscode';

let extCtx: vscode.ExtensionContext; // set in activate to access SecretStorage

class SweAgentViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sweAgent.chatView';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media')
      ]
    };

    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.js')
    );
    const styleUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.css')
    );

    webviewView.webview.html = getWebviewContent(scriptUri.toString(), styleUri.toString());

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'userMessage') {
        const response = await AgentCore.handleUserMessage(message.text);
        webviewView.webview.postMessage({ type: 'assistantMessage', text: response.message });

        if (response.previewEdits && response.previewEdits.length > 0) {
          lastPreviewEdits = response.previewEdits;
          await showEditsAsDiffs(response.previewEdits);
          const applyHint = 'Preview ready. Run the command "SWE Agent: Apply Proposed Changes" to apply.';
          webviewView.webview.postMessage({ type: 'assistantMessage', text: applyHint });
        }
      }
    });
  }
}

interface ProposedTextEdit {
  uri: string; // vscode.Uri.toString()
  edits: Array<{ range: { start: number; end: number }; newText: string }>;
}

let lastPreviewEdits: ProposedTextEdit[] | undefined;

async function showEditsAsDiffs(previewEdits: ProposedTextEdit[]) {
  for (const file of previewEdits) {
    const original = vscode.Uri.parse(file.uri);
    const editedDoc = await vscode.workspace.openTextDocument(original);

    const tempDoc = await vscode.workspace.openTextDocument({
      content: applyInMemory(editedDoc.getText(), file.edits),
      language: editedDoc.languageId
    });

    const left = editedDoc.uri;
    const right = tempDoc.uri;
    const title = `Preview: ${vscode.workspace.asRelativePath(original)}`;

    await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
  }
}

async function applyProposedEdits(previewEdits: ProposedTextEdit[]): Promise<void> {
  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const file of previewEdits) {
    const uri = vscode.Uri.parse(file.uri);
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      // If file doesn't exist, create it with new content if a full replacement is proposed
      if (file.edits.length === 1 && file.edits[0].range.start === 0) {
        const content = file.edits[0].newText;
        workspaceEdit.createFile(uri, { ignoreIfExists: false, overwrite: true });
        workspaceEdit.insert(uri, new vscode.Position(0, 0), content);
        continue;
      }
      throw new Error(`Unable to open document ${uri.toString()}`);
    }

    // Sort edits descending by start offset to keep positions stable
    const sorted = [...file.edits].sort((a, b) => b.range.start - a.range.start);
    for (const e of sorted) {
      const startPos = document.positionAt(e.range.start);
      const endPos = document.positionAt(e.range.end);
      workspaceEdit.replace(uri, new vscode.Range(startPos, endPos), e.newText);
    }
  }

  const applied = await vscode.workspace.applyEdit(workspaceEdit);
  if (!applied) {
    throw new Error('Failed to apply workspace edits.');
  }
}

function applyInMemory(originalText: string, edits: ProposedTextEdit['edits']): string {
  // Apply edits from end to start to keep offsets valid
  let text = originalText;
  const ordered = [...edits].sort((a, b) => b.range.start - a.range.start);
  for (const e of ordered) {
    text = text.slice(0, e.range.start) + e.newText + text.slice(e.range.end);
  }
  return text;
}

class AgentCore {
  static async handleUserMessage(userText: string): Promise<{ message: string; previewEdits?: ProposedTextEdit[] }> {
    // Quick demo behaviors
    const quickCreateMatch = userText.match(/create file ([^\s]+) with content\s+([\s\S]+)/i);
    if (quickCreateMatch) {
      const relPath = quickCreateMatch[1];
      const content = quickCreateMatch[2];
      const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0].uri!, relPath);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      return { message: `Created file ${relPath}.` };
    }

    const quickReplaceMatch = userText.match(/replace in ([^\s]+) from <start:(\d+)> to <end:(\d+)> with\s+([\s\S]+)/i);
    if (quickReplaceMatch) {
      const relPath = quickReplaceMatch[1];
      const start = Number(quickReplaceMatch[2]);
      const end = Number(quickReplaceMatch[3]);
      const newText = quickReplaceMatch[4];
      const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0].uri!, relPath);
      const preview: ProposedTextEdit = { uri: uri.toString(), edits: [{ range: { start, end }, newText }] };
      return { message: `Proposed replace in ${relPath} [${start}, ${end}).`, previewEdits: [preview] };
    }

    const hint = await buildStatusHint();
    return { message: `You said: "${userText}". ${hint}` };
  }
}

async function buildStatusHint(): Promise<string> {
  const config = vscode.workspace.getConfiguration('sweAgent');
  const provider = config.get<string>('provider');
  const model = config.get<string>('model');
  const secretKey = extCtx ? await extCtx.secrets.get('sweAgent.apiKey') : undefined;
  const hasKeyCfg = !!config.get<string>('apiKey');
  const hasKey = !!secretKey || hasKeyCfg;
  return hasKey
    ? `Using provider ${provider} with model ${model}. Ask me to search, refactor, or implement features.`
    : `No API key set yet. Run: SWE Agent: Set API Key.`;
}

function getWebviewContent(scriptUri: string, styleUri: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; script-src 'nonce-abcdef'; style-src 'unsafe-inline';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${styleUri}" rel="stylesheet" />
<title>SWE Agent</title>
</head>
<body>
  <div id="messages"></div>
  <div class="input-row">
    <textarea id="prompt" rows="3" placeholder="Ask the SWE Agent..."></textarea>
    <button id="send">Send</button>
  </div>
  <script nonce="abcdef" src="${scriptUri}"></script>
</body>
</html>`;
}

export function activate(context: vscode.ExtensionContext) {
  extCtx = context;
  const provider = new SweAgentViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SweAgentViewProvider.viewType, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sweAgent.openPanel', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.sweAgent');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sweAgent.applyPlan', async () => {
      if (!lastPreviewEdits || lastPreviewEdits.length === 0) {
        vscode.window.showWarningMessage('No preview edits to apply. Ask the agent to propose changes first.');
        return;
      }
      try {
        await applyProposedEdits(lastPreviewEdits);
        vscode.window.showInformationMessage('Applied proposed changes.');
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to apply changes: ${err?.message ?? String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sweAgent.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter API key for the selected provider',
        password: true,
        ignoreFocusOut: true
      });
      if (!key) {
        return;
      }
      await context.secrets.store('sweAgent.apiKey', key);
      vscode.window.showInformationMessage('SWE Agent API key saved to Secret Storage.');
    })
  );
}

export function deactivate() {}