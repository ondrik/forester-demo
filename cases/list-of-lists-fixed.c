#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);

/* an item of an inner list */
struct item {
    struct item *next;
};

/* a node of the outer list, with its own inner list */
struct bucket {
    struct bucket *next;
    struct item *items;
};

struct bucket *create(void)
{
    struct bucket *buckets = NULL;
    while (__VERIFIER_nondet_int()) {
        struct bucket *b = malloc(sizeof *b);
        b->items = NULL;
        while (__VERIFIER_nondet_int()) {
            struct item *it = malloc(sizeof *it);
            it->next = b->items;
            b->items = it;
        }
        b->next = buckets;
        buckets = b;
    }
    return buckets;
}

void destroy(struct bucket *b)
{
    while (b) {
        struct bucket *next = b->next;
        while (b->items) {
            struct item *it = b->items;
            b->items = it->next;
            free(it);
        }
        free(b);
        b = next;
    }
}

int main(void)
{
    destroy(create());
    return 0;
}
