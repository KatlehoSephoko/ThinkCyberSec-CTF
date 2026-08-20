from PIL import Image

def generate_lsb(cover, secret, out):
    img = Image.open(cover).convert('RGB')
    pixels = list(img.getdata())
    with open(secret, "rb") as f: data = f.read() + b'TCS_EOF'
    binary = ''.join([format(b, '08b') for b in data])
    
    new_pixels, i = [], 0
    for r, g, b in pixels:
        if i < len(binary): r = (r & ~1) | int(binary[i]); i += 1
        if i < len(binary): g = (g & ~1) | int(binary[i]); i += 1
        if i < len(binary): b = (b & ~1) | int(binary[i]); i += 1
        new_pixels.append((r, g, b))
        
    stego = Image.new('RGB', img.size)
    stego.putdata(new_pixels)
    stego.save(out)

generate_lsb("cover.png", "secret.wav", "stego_challenge.png")
