"""Opens a Tk window, waits until it is shown, then closes it. Writes the results to the file
named by DRP_FIXTURE_OUT, because a windowed Windows app has no stdout."""

import json
import os
import sys
import tkinter as tk

result = {"frozen": getattr(sys, "frozen", False), "stdout_is_none": sys.stdout is None}
root = tk.Tk()
root.title("dropring-pack ✓")
label = tk.Label(root, text="çalışıyor ✓")
label.pack(padx=40, pady=20)
attempts = 0


def check():
    global attempts
    attempts += 1
    if root.winfo_ismapped() or attempts > 100:
        result.update(
            mapped=bool(root.winfo_ismapped()),
            title=root.title(),
            label=label.cget("text"),
            tk=str(root.tk.call("info", "patchlevel")),
        )
        root.destroy()
    else:
        root.after(100, check)


root.after(100, check)
root.mainloop()
with open(os.environ["DRP_FIXTURE_OUT"], "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False)
