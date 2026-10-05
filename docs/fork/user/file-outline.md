# File outline

Open a supported file in the Files panel and choose **Show outline** to browse its
functions, types, methods or Markdown headings. Choose a symbol to jump to its source
line. The outline follows the active file and updates as you edit. Loom remembers whether
you left it open.

Type in **Filter symbols** to narrow the list. Letters can be separated, so `ldd` matches
`loadData`. Matching members keep their parent types visible. Use Up and Down to select,
then Enter to jump. Escape clears the filter; a second Escape returns focus to the file.

The command palette also offers **Toggle file outline** and **Go to symbol in file**.
Symbol search works with the outline closed. To assign a shortcut, open
**Settings > Keybindings** and find **Loom: File Outline: Toggle**. It has no default key.

Supported files include TypeScript and JavaScript, including TSX, JSX and module variants,
Swift, Python, Go, Rust, Kotlin, and Markdown. Markdown heading jumps open source view.
Images, PDFs, tables, and attachments have no outline.

Large previews cover the loaded first 1 MB and show up to 2,000 symbols. The outline works
in web and desktop, including connections to remote and upstream T3 servers.
