from Crypto.Util.number import getPrime, bytes_to_long
p, q = getPrime(128), getPrime(128)
n, e = p * q, 65537
c = pow(bytes_to_long(b"tcs{p_and_q_factored}"), e, n)
print(f"N={n}\ne={e}\nc={c}")
