# An unlabelled fence detects its own language

JSON:

```
{ "name": "Price", "type": "number", "config": { "format": "currency", "currency": "USD" } }
```

A shell session:

```
weave query Task --where '[["State","=","Open"]]' --select 'Due,Owner'
```

HTML:

```
<section class="card"><h2>Hello</h2></section>
```

Nothing on the fence names a language. The content decides, and anything unrecognised stays plain text — the right answer for a config snippet nobody has a grammar for.