import sys, idapro
idapro.enable_console_messages(False)
idapro.open_database(sys.argv[1], True)
import idautils, ida_funcs
for a in sys.argv[2:]:
    ea=int(a,16)
    print(hex(ea), [ (hex(x.frm), ida_funcs.get_func_name(x.frm)) for x in idautils.XrefsTo(ea)])
    # also vtable (data) refs
idapro.close_database(False)
