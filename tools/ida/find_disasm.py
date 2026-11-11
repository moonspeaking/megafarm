import sys, idapro
idapro.enable_console_messages(False)
idapro.open_database(sys.argv[1], True)
import idautils, idc, ida_funcs
pats = [p.lower() for p in sys.argv[2:]]
hits = {}
for fea in idautils.Functions():
    for h in idautils.FuncItems(fea):
        d = idc.generate_disasm_line(h, 0).lower()
        for p in pats:
            if p in d:
                hits.setdefault(fea, []).append((hex(h), p, d))
for fea, l in hits.items():
    print(hex(fea), ida_funcs.get_func_name(fea), len(l), sorted(set(x[1] for x in l)))
idapro.close_database(False)
