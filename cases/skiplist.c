#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);

/* a two-level skip list: every node is on level 1, some also on level 2 */
struct node {
    struct node *next1;
    struct node *next2;
};

struct skiplist {
    struct node *head;
    struct node *tail;
};

struct skiplist *create(void)
{
    struct skiplist *sl = malloc(sizeof *sl);
    sl->head = malloc(sizeof *sl->head);
    sl->tail = malloc(sizeof *sl->tail);
    sl->head->next1 = sl->head->next2 = sl->tail;
    sl->tail->next1 = sl->tail->next2 = NULL;
    return sl;
}

/* insert a node at an arbitrary position, with an arbitrary height */
void insert(struct skiplist *sl)
{
    /* find the predecessors on both levels */
    struct node *pred2 = sl->head;
    while (pred2->next2 != sl->tail && __VERIFIER_nondet_int())
        pred2 = pred2->next2;
    struct node *pred1 = pred2;
    while (pred1->next1 != pred2->next2 && __VERIFIER_nondet_int())
        pred1 = pred1->next1;

    struct node *n = malloc(sizeof *n);
    if (__VERIFIER_nondet_int()) {
        /* a tall node: on both levels */
        n->next2 = pred2->next2;
        pred2->next2 = n;
    } else {
        /* a short node: on level 1 only */
        n->next2 = NULL;
        n->next1 = pred1->next1;
        pred1->next1 = n;
    }
}

/* every node is on level 1, so it is enough to walk that level */
void destroy(struct skiplist *sl)
{
    struct node *n = sl->head;
    while (n) {
        struct node *next = n->next1;
        free(n);
        n = next;
    }
    free(sl);
}

int main(void)
{
    struct skiplist *sl = create();
    while (__VERIFIER_nondet_int())
        insert(sl);
    destroy(sl);
    return 0;
}
