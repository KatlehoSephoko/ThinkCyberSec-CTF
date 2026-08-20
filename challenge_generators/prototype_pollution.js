const express = require('express');
const app = express();
app.use(express.json({ type: 'application/json' }));

function merge(t, s) {
    for (let k in s) {
        if (typeof t[k] === 'object' && typeof s[k] === 'object') merge(t[k], s[k]);
        else t[k] = s[k];
    }
    return t;
}

let settings = { theme: "dark" };

app.post('/api/settings', (req, res) => {
    merge(settings, req.body);
    res.json({ msg: "Updated" });
});

app.get('/api/admin/flag', (req, res) => {
    let session = {}; 
    if (session.isAdmin === true) res.json({ flag: "tcs{js_prototype_polluted}" });
    else res.status(403).json({ error: "Access Denied" });
});
app.listen(4000);
