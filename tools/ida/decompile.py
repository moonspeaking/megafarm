import sys, idapro
idapro.enable_console_messages(False)
path = sys.argv[1]
idapro.open_database(path, True)
import idautils, idc, ida_funcs, ida_hexrays, ida_name
for a in sys.argv[2:]:
    ea = int(a, 16)
    f = ida_funcs.get_func(ea)
    print("=" * 30, hex(ea), ida_funcs.get_func_name(ea))
    try:
        cf = ida_hexrays.decompile(f.start_ea)
        print(str(cf))
    except Exception as e:
        print("decompile failed", e)
idapro.close_database(False)
