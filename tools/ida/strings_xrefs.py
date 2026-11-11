import sys, idapro
idapro.enable_console_messages(False)
path = sys.argv[1]
pats = sys.argv[2:]
idapro.open_database(path, True)
import idautils, idc, ida_funcs, ida_xref, ida_bytes, ida_hexrays
print("hexrays:", ida_hexrays.init_hexrays_plugin())
sc = idautils.Strings()
sc.setup(strtypes=[idc.STRTYPE_C, idc.STRTYPE_C_16], minlen=4)
sc.refresh()
for s in sc:
    t = str(s)
    if any(p in t for p in pats):
        refs = [hex(x.frm) + "@" + (ida_funcs.get_func_name(x.frm) or "?") for x in idautils.XrefsTo(s.ea)]
        print(hex(s.ea), repr(t), refs[:6])
idapro.close_database(False)
