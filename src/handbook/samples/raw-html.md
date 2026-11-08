# Raw HTML

When markdown will not say it:

<div style="border-left:3px solid #4769eb;padding:.6rem .9rem;border-radius:6px">
<strong>Note.</strong> A raw HTML block passes through the renderer untouched, in the editor and in the HTML export.
</div>

The HTML export, a shared page and a whole HTML document open in a sandbox: their scripts run without your session and cannot call the workspace API. A view description and the task applet show an HTML block as text.

Raw HTML is inserted through the slash menu rather than typed, because the insert path spins what it inserts through the markdown engine in a context that drops an HTML block outright. A whole-document write round-trips it untouched.