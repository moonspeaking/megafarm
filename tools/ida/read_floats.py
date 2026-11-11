import sys, idapro, struct
idapro.enable_console_messages(False)
idapro.open_database(sys.argv[1], True)
import ida_bytes
for a in sys.argv[2:]:
    ea=int(a,16)
    print(a, struct.unpack('<f', ida_bytes.get_bytes(ea,4))[0], '| dbl', struct.unpack('<d', ida_bytes.get_bytes(ea,8))[0] if True else '')
idapro.close_database(False)
