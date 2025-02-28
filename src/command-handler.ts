import * as vscode from "vscode";
import * as diff from "./diff";
import Settings from "./settings";
const ignoreParser: any = require("gitignore-globs");
import * as path from 'path';

export default class CommandHandler {
  private activeEditor?: vscode.TextEditor;
  private errorColor: string = "255, 99, 71";
  private openFileList: any[] = [];
  private successColor: string = "43, 161, 67";
  private languageToExtension: { [key: string]: string[] } = {
    c: ["c", "h"],
    cpp: ["cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++"],
    csharp: ["cs"],
    css: ["css", "scss"],
    dart: ["dart"],
    go: ["go"],
    html: ["html", "vue", "svelte"],
    java: ["java"],
    javascript: ["js", "jsx"],
    javascriptreact: ["jsx", "js"],
    jsx: ["jsx", "js"],
    kotlin: ["kt"],
    python: ["py"],
    ruby: ["rb"],
    rust: ["rs"],
    scss: ["scss"],
    shellscript: ["sh", "bash"],
    typescript: ["ts", "tsx"],
    typescriptreact: ["tsx", "ts"],
    vue: ["vue", "html"],
  };

  constructor(private settings: Settings) {}

  private async focus(): Promise<any> {
    this.updateActiveEditor();
    if (!this.activeEditor) {
      return;
    }

    await vscode.window.showTextDocument(this.activeEditor!.document);
    await this.uiDelay();
  }

  private highlightRanges(ranges: diff.DiffRange[]): number {
    const duration = 300;
    const steps = [1, 2, 1];
    const step = duration / steps.length;
    const editor = vscode.window.activeTextEditor;
    if (!editor || ranges.length == 0) {
      return 0;
    }

    for (const range of ranges) {
      const decorations = steps.map((e) =>
        vscode.window.createTextEditorDecorationType({
          backgroundColor: `rgba(${
            range.diffRangeType == diff.DiffRangeType.Delete ? this.errorColor : this.successColor
          }, 0.${e})`,
          isWholeLine: range.diffHighlightType == diff.DiffHighlightType.Line,
        })
      );

      // atom and vs code use different types of ranges
      if (range.diffHighlightType == diff.DiffHighlightType.Line) {
        range.stop.row--;
      }

      for (let i = 0; i < steps.length; i++) {
        setTimeout(() => {
          this.activeEditor!.setDecorations(decorations[i], [
            new vscode.Range(
              range.start.row,
              range.start.column,
              range.stop.row,
              range.stop.column
            ),
          ]);

          setTimeout(() => {
            decorations[i].dispose();
          }, step);
        }, i * step);
      }
    }

    return 400;
  }

  private rowAndColumnToCursor(row: number, column: number, text: string) {
    // iterate through text, incrementing rows when newlines are found, and counting columns when row is right
    let cursor = 0;
    let currentRow = 0;
    let currentColumn = 0;
    for (let i = 0; i < text.length; i++) {
      if (currentRow === row) {
        if (currentColumn === column) {
          break;
        }

        currentColumn++;
      }

      if (text[i] === "\n") {
        currentRow++;
      }

      cursor++;
    }

    return cursor;
  }

  private async scrollToCursor(): Promise<any> {
    if (!this.activeEditor) {
      return;
    }

    const cursor = this.activeEditor!.selection.start.line;
    if (this.activeEditor!.visibleRanges.length > 0) {
      const range = this.activeEditor!.visibleRanges[0];
      const buffer = 5;
      if (cursor < range.start.line + buffer || cursor > range.end.line - buffer) {
        await vscode.commands.executeCommand("revealLine", {
          lineNumber: cursor,
          at: "center",
        });
      }
    }
  }

  private async setSourceAndCursor(
    before: string,
    source: string,
    row: number,
    column: number
  ): Promise<void> {
    if (!this.activeEditor) {
      return;
    }

    if (before != source) {
      await this.activeEditor.edit((edit) => {
        // Compute the shared prefix and postfix, so we can swap out the range between them and not disrupt
        // the rust analyzer as much.
        let startIndex = 0;
        while (
          startIndex < before.length &&
          startIndex < source.length &&
          before[startIndex] == source[startIndex]
        ) {
          startIndex++;
        }
        let stopOffset = 0;
        while (
          before.length - stopOffset - 1 >= startIndex &&
          source.length - stopOffset - 1 >= startIndex &&
          before[before.length - stopOffset - 1] == source[source.length - stopOffset - 1]
        ) {
          stopOffset++;
        }
        // don't split crlf when we strip them in serenade.
        if (before.length - stopOffset - 1 >= 0 &&
            before[before.length - stopOffset - 1] == "\r") {
          stopOffset--;
        }
        const [startLine, startCharacter] = diff.cursorToRowAndColumn(before, startIndex);
        const [stopLine, stopCharacter] = diff.cursorToRowAndColumn(
          before,
          before.length - stopOffset
        );

        const textRange = new vscode.Range(startLine, startCharacter, stopLine, stopCharacter);
        edit.replace(textRange, source.substring(startIndex, source.length - stopOffset));
      });
    }

    this.activeEditor.selections = [new vscode.Selection(row, column, row, column)];
  }

  private async uiDelay(timeout: number = 100): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, timeout);
    });
  }

  private updateActiveEditor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    this.activeEditor = editor;
  }

  async COMMAND_TYPE_CLOSE_TAB(_data: any): Promise<any> {
    await this.focus();
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await this.uiDelay();
    this.updateActiveEditor();
  }

  async COMMAND_TYPE_CLOSE_WINDOW(_data: any): Promise<any> {
    await this.focus();
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await this.uiDelay();
    this.updateActiveEditor();
  }

  async COMMAND_TYPE_COPY(data: any): Promise<any> {
    if (data && data.text) {
      vscode.env.clipboard.writeText(data.text);
    }

    await this.uiDelay();
  }

  async COMMAND_TYPE_CREATE_TAB(_data: any): Promise<any> {
    await this.focus();
    await vscode.commands.executeCommand("workbench.action.files.newUntitledFile");
    await this.uiDelay();
    this.updateActiveEditor();
  }

  async COMMAND_TYPE_DUPLICATE_TAB(_data: any): Promise<any> {}

  async COMMAND_TYPE_GET_EDITOR_STATE(data: any): Promise<any> {
    let result: any = {
      message: "editorState",
      data: {
        source: "",
        cursor: 0,
        selectionStart: 0,
        selectionEnd: 0,
        filename: "",
      },
    };

    if (!this.activeEditor) {
      return result;
    }

    let filename = this.activeEditor.document.fileName;
    const language = this.activeEditor.document.languageId;
    if (language && this.languageToExtension[language]) {
      if (!this.languageToExtension[language].some((e: string) => filename.endsWith(`.${e}`))) {
        filename = (filename || "file") + `.${this.languageToExtension[language][0]}`;
      }
    }

    result.data.filename = filename;
    if (data.limited) {
      return result;
    }

    // filter out the longest root that's a prefix of the filename
    const roots = vscode.workspace.workspaceFolders
      ? vscode.workspace.workspaceFolders.map((e: any) => e.uri.path)
      : [];
    let files = [];
    for (const file of this.openFileList.map((e: any) => e.path)) {
      let prefixLength = 0;
      for (const root of roots) {
        if (file.startsWith(root) && prefixLength < file.length) {
          prefixLength = root.length + 1;
        }
      }

      files.push(file.substring(prefixLength));
    }
    result.data.files = files;

    const source = this.activeEditor!.document.getText();
    const cursorPosition = this.activeEditor!.selection.active;
    const anchorPosition = this.activeEditor!.selection.anchor;
    const cursor = this.rowAndColumnToCursor(cursorPosition.line, cursorPosition.character, source);
    const anchor = this.rowAndColumnToCursor(anchorPosition.line, anchorPosition.character, source);
    if (cursor != anchor) {
      result.data.selectionStart = cursor > anchor ? anchor : cursor;
      result.data.selectionEnd = cursor < anchor ? anchor : cursor;
    }

    result.data.source = source;
    result.data.cursor = this.rowAndColumnToCursor(
      cursorPosition.line,
      cursorPosition.character,
      source
    );
    result.data.available = true;
    result.data.canGetState = true;
    result.data.canSetState = true;
    return result;
  }

  async COMMAND_TYPE_DEBUGGER_CONTINUE(_data: any): Promise<any> {
    vscode.commands.executeCommand("workbench.action.debug.continue");
  }

  async COMMAND_TYPE_DEBUGGER_INLINE_BREAKPOINT(_data: any): Promise<any> {
    await vscode.commands.executeCommand("editor.debug.action.toggleInlineBreakpoint");
  }

  async COMMAND_TYPE_DEBUGGER_PAUSE(_data: any): Promise<any> {
    vscode.commands.executeCommand("workbench.action.debug.pause");
  }

  async COMMAND_TYPE_DEBUGGER_SHOW_HOVER(_data: any): Promise<any> {
    await this.focus();
    vscode.commands.executeCommand("editor.debug.action.showDebugHover");
  }

  async COMMAND_TYPE_DEBUGGER_START(_data: any): Promise<any> {
    vscode.commands.executeCommand("workbench.action.debug.start");
  }

  async COMMAND_TYPE_DEBUGGER_STEP_INTO(_data: any): Promise<any> {
    vscode.commands.executeCommand("workbench.action.debug.stepInto");
  }

  async COMMAND_TYPE_DEBUGGER_STEP_OUT(_data: any): Promise<any> {
    vscode.commands.executeCommand("workbench.action.debug.stepOut");
  }

  async COMMAND_TYPE_DEBUGGER_STEP_OVER(_data: any): Promise<any> {
    vscode.commands.executeCommand("workbench.action.debug.stepOver");
  }

  async COMMAND_TYPE_DEBUGGER_STOP(_data: any): Promise<any> {
    vscode.commands.executeCommand("workbench.action.debug.stop");
  }

  async COMMAND_TYPE_DEBUGGER_TOGGLE_BREAKPOINT(_data: any): Promise<any> {
    vscode.commands.executeCommand("editor.debug.action.toggleBreakpoint");
  }

  async COMMAND_TYPE_DIFF(data: any): Promise<any> {
    await this.focus();
    if (!this.activeEditor) {
      return;
    }

    const before = this.activeEditor.document.getText() || "";
    let [row, column] = diff.cursorToRowAndColumn(data.source, data.cursor);
    if (!this.settings.getAnimations()) {
      await this.setSourceAndCursor(before, data.source, row, column);
      await this.scrollToCursor();
      return;
    }

    let ranges = diff.diff(before, data.source);
    if (ranges.length == 0) {
      ranges = [
        new diff.DiffRange(
          diff.DiffRangeType.Add,
          diff.DiffHighlightType.Line,
          new diff.DiffPoint(row, 0),
          new diff.DiffPoint(row + 1, 0)
        ),
      ];
    }

    const addRanges = ranges.filter(
      (e: diff.DiffRange) => e.diffRangeType == diff.DiffRangeType.Add
    );

    const deleteRanges = ranges.filter(
      (e: diff.DiffRange) => e.diffRangeType == diff.DiffRangeType.Delete
    );

    const timeout = this.highlightRanges(deleteRanges);
    return new Promise((resolve) => {
      setTimeout(
        async () => {
          await this.setSourceAndCursor(before, data.source, row, column);
          this.highlightRanges(addRanges);
          await this.scrollToCursor();
          resolve(null);
        },
        deleteRanges.length > 0 ? timeout : 1
      );
    });
  }

  async COMMAND_TYPE_EVALUATE_IN_PLUGIN(data: any): Promise<any> {
    const input = (data.text || "").trim();

    console.log("eval in plugin input");

    //Check if the input starts with touch
    if (input.startsWith("touch")) {
      console.log("touching file");
      //Extract everything after touch and space
      const fileUri = input.substring(6)
      await this.COMMAND_TYPE_TOUCH(fileUri);
    } else if (input.startsWith("remove")) {
      console.log("removing file");
      //Extract everything after remove and space
      const fileUri = input.substring(7)
      await this.COMMAND_TYPE_REMOVE(fileUri);
    } else {
      console.log("executing command");
      vscode.commands.executeCommand(data.text);
    }

  }

  async COMMAND_TYPE_TOUCH(data: any): Promise<any> {
    // Get current folder as the location of the currently selected file
    const currentFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    const currentFolder = currentFile ? path.dirname(currentFile) : '';
    const filePath = path.join(currentFolder, data);
  
    const fileUri = vscode.Uri.file(filePath);
    const fileContent = Buffer.from('');
    await vscode.workspace.fs.writeFile(fileUri, fileContent);
    await vscode.window.showTextDocument(fileUri);  
  }

  async COMMAND_TYPE_REMOVE(data: any): Promise<any> {
    const fileUri = vscode.Uri.file(data);
    await vscode.workspace.fs.delete(fileUri);
  }

  //Command that enters text into chat codebase

  async COMMAND_TYPE_CHAT_ASK_CODEBASE(_data: any): Promise<any> {
    await vscode.commands.executeCommand("aichat.doAdvancedCodebaseQuery");
  }

  //Command that enters text into chat codebase
  async COMMAND_TYPE_CHAT_FOLLOWUP(_data: any): Promise<any> {
    await vscode.commands.executeCommand("aichat.newfollowupaction");
  }

  //Command that opens up new chat
  async COMMAND_TYPE_CHAT_NEW(_data: any): Promise<any> {
    await vscode.commands.executeCommand("aichat.newchataction");
  }

  //Command that focus on the chat window
  async COMMAND_TYPE_CHAT_FOCUS(_data: any): Promise<any> {
    await vscode.commands.executeCommand("aichat.focus");
  }

  //Command that toggles between chats
  async COMMAND_TYPE_CHAT_TOGGLE(_data: any): Promise<any> {
    await vscode.commands.executeCommand("aichat.switchToMostRecentChat");
  }

  async COMMAND_TYPE_GO_TO_DEFINITION(_data: any): Promise<any> {
    await this.focus();
    await vscode.commands.executeCommand("editor.action.revealDefinition");
  }

  async COMMAND_TYPE_NEXT_TAB(_data: any): Promise<any> {
    await this.focus();
    await vscode.commands.executeCommand("workbench.action.nextEditor");
    await this.uiDelay();
    this.updateActiveEditor();
  }

  async COMMAND_TYPE_OPEN_FILE(data: any): Promise<any> {
    await vscode.window.showTextDocument(this.openFileList[data.index || 0]);
  }

  async COMMAND_TYPE_OPEN_FILE_LIST(data: any): Promise<any> {
    await this.focus();

    const path = data.path
      .replace(/\//, "*/*")
      .split("")
      .map((e: string) => {
        if (e == " ") {
          return "*";
        } else if (e.match(/[a-z]/)) {
          return `{${e.toUpperCase()},${e.toLowerCase()}}`;
        }

        return e;
      })
      .join("");

    let exclude: string[] = [
      "**/.git",
      "**/.hg",
      "**/node_modules",
      "**/npm_packages",
      "**/npm",
      ...Object.keys(
        (await vscode.workspace.getConfiguration("search", null).get("exclude")) || {}
      ),
      ...Object.keys((await vscode.workspace.getConfiguration("files", null).get("exclude")) || {}),
    ];

    const ignorePath = await vscode.workspace.findFiles(".gitignore");
    if (ignorePath.length > 0) {
      exclude = exclude.concat(
        ignoreParser._map(
          ignoreParser._prepare(
            Buffer.from(await vscode.workspace.fs.readFile(ignorePath[0]))
              .toString("utf-8")
              .split("\n")
          )
        )
      );
    }

    this.openFileList = await vscode.workspace.findFiles(
      `**/*${path}*`,
      `{${exclude.map((e: string) => e.replace(/\\/g, "/")).join(",")}}`,
      10
    );

    return { message: "sendText", data: { text: "callback open" } };
  }

  async COMMAND_TYPE_PREVIOUS_TAB(_data: any): Promise<any> {
    await this.focus();
    await vscode.commands.executeCommand("workbench.action.previousEditor");
    await this.uiDelay();
    this.updateActiveEditor();
  }

  async COMMAND_TYPE_REDO(_data: any): Promise<any> {
    await this.focus();
    await vscode.commands.executeCommand("redo");
    await this.scrollToCursor();
  }

  async COMMAND_TYPE_SAVE(_data: any): Promise<any> {
    await this.focus();
    await vscode.commands.executeCommand("workbench.action.files.save");
  }

  async COMMAND_TYPE_SELECT(data: any): Promise<any> {
    if (!this.activeEditor) {
      return;
    }

    const [startRow, startColumn] = diff.cursorToRowAndColumn(data.source, data.cursor);
    const [endRow, endColumn] = diff.cursorToRowAndColumn(data.source, data.cursorEnd);
    this.activeEditor!.selections = [
      new vscode.Selection(startRow, startColumn, endRow, endColumn),
    ];
  }

  async COMMAND_TYPE_SPLIT(data: any): Promise<any> {
    await this.focus();
    const direction = data.direction.toLowerCase();
    const split = direction.charAt(0).toUpperCase() + direction.slice(1);
    await vscode.commands.executeCommand(`workbench.action.splitEditor${split}`);
    await this.uiDelay();
    this.updateActiveEditor();
  }

  async COMMAND_TYPE_STYLE(_data: any): Promise<any> {
    await this.focus();
    await vscode.commands.executeCommand("editor.action.formatDocument");
    await this.uiDelay();
  }

  async COMMAND_TYPE_SWITCH_TAB(data: any): Promise<any> {
    await this.focus();
    if (data.index <= 0) {
      await vscode.commands.executeCommand("workbench.action.lastEditorInGroup");
    } else {
      await vscode.commands.executeCommand(`workbench.action.openEditorAtIndex${data.index}`);
    }

    await this.uiDelay();
    this.updateActiveEditor();
  }

  async COMMAND_TYPE_UNDO(_data: any): Promise<any> {
    await this.focus();
    await vscode.commands.executeCommand("undo");
    await this.scrollToCursor();
  }

  async COMMAND_TYPE_WINDOW(data: any): Promise<any> {
    await this.focus();
    const direction = data.direction.toLowerCase();
    const split = direction.charAt(0).toUpperCase() + direction.slice(1);
    await vscode.commands.executeCommand(`workspace.action.focus${split}Group`);
    await this.uiDelay();
    this.updateActiveEditor();
  }

  pollActiveEditor() {
    setInterval(() => {
      this.updateActiveEditor();
    }, 1000);
  }
}
