export const SIEVE = `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int limit;
    cin >> limit;
    vector<bool> composite(limit + 1, false);
    int primes = 0;
    for (int candidate = 2; candidate <= limit; candidate++) {
        if (composite[candidate]) continue;
        primes++;
        for (long long multiple = 1LL * candidate * candidate; multiple <= limit; multiple += candidate)
            composite[multiple] = true;
    }
    cout << primes << "\\n";
    return 0;
}
`;

/** `SIEVE` with every identifier renamed and one extra comment line. */
export const SIEVE_RENAMED = `#include <iostream>
#include <vector>
using namespace std;

// counts primes up to N
int main() {
    int n;
    cin >> n;
    vector<bool> notPrime(n + 1, false);
    int count = 0;
    for (int i = 2; i <= n; i++) {
        if (notPrime[i]) continue;
        count++;
        for (long long j = 1LL * i * i; j <= n; j += i)
            notPrime[j] = true;
    }
    cout << count << "\\n";
    return 0;
}
`;

/** A different algorithm entirely. */
export const KNAPSACK = `#include <bits/stdc++.h>
using namespace std;
int main() {
    int items, capacity;
    scanf("%d %d", &items, &capacity);
    vector<int> weight(items), value(items);
    for (int index = 0; index < items; index++) scanf("%d %d", &weight[index], &value[index]);
    vector<long long> best(capacity + 1, 0);
    for (int index = 0; index < items; index++)
        for (int room = capacity; room >= weight[index]; room--)
            best[room] = max(best[room], best[room - weight[index]] + value[index]);
    printf("%lld\\n", best[capacity]);
}
`;

export const lineCount = (source: string): number =>
  source.trimEnd().split('\n').length;
