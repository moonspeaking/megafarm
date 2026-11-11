# IDA helpers (idalib)

Scripts that open a *copy* of the original executable with `idalib` and print
decompiled functions, string cross-references, etc.

    PY=~/.local/share/ida-venv/bin/python
    cp ".../Farm Craft/farm m.exe" /tmp/farm.exe     # work on a copy: IDA writes a database next to it
    $PY tools/ida/strings_xrefs.py /tmp/farm.exe plant_ thirst     # strings + referencing functions
    $PY tools/ida/decompile.py /tmp/farm.exe 0x41f2a0 0x41fb90      # Hex-Rays output
    $PY tools/ida/find_disasm.py /tmp/farm.exe "2570h]"             # functions touching a field offset
    $PY tools/ida/callers.py /tmp/farm.exe 0x417020
    $PY tools/ida/read_floats.py /tmp/farm.exe 0x45f798             # float constants

`farm m.exe` (= `FarmCraft.RWG`) is the real game; `FarmCraft.exe` is only the
Reflexive Arcade wrapper. `IDADIR` must point to the installed IDA (9.5 here).
