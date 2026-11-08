# Math

Inline: the run rate is $r = \frac{\sum_{i=1}^{n} c_i}{n}$ over the trailing months.

As a block:

$$
\text{Total} = \sum_{i=1}^{n} p_i q_i \qquad \sigma = \sqrt{\frac{1}{n}\sum (x_i - \mu)^2}
$$

## Chemistry

mhchem rides along with KaTeX, so $\ce{2H2 + O2 -> 2H2O}$ and $\ce{CO2 + H2O <=> H2CO3}$ typeset properly.

That is not a bonus. The math render callback lives inside mhchem's load — remove mhchem and **all** math stops rendering, not only the chemistry.

KaTeX is the only optional renderer vendored into the tree.