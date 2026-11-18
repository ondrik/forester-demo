#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);

struct node {
    struct node *left;
    struct node *right;
};

struct node *create(void)
{
    struct node *root = malloc(sizeof *root);
    root->left = NULL;
    root->right = NULL;

    while (__VERIFIER_nondet_int()) {
        struct node *n = root;
        while (n->left && n->right)
            n = __VERIFIER_nondet_int() ? n->left : n->right;

        struct node *leaf = malloc(sizeof *leaf);
        leaf->left = NULL;
        leaf->right = NULL;
        if (!n->left)
            n->left = leaf;
        else
            n->right = leaf;
    }
    return root;
}

/*
 * Lindstrom's variant of the Deutsch-Schorr-Waite traversal: visits every node
 * without a stack, by rotating the child pointers.  After three visits, each
 * node has its original children back.
 */
void traverse(struct node *root)
{
    struct node *sentinel = malloc(sizeof *sentinel);
    struct node *n = root, *pred = sentinel;

    while (n != sentinel) {
        struct node *succ = n->left;
        n->left = n->right;
        n->right = pred;
        pred = n;
        n = succ;
        if (!n) {
            n = pred;
            pred = NULL;
        }
    }
    free(sentinel);
}

/* destroys the tree with an explicit stack */
struct item {
    struct item *next;
    struct node *node;
};

void destroy(struct node *root)
{
    struct item *stack = malloc(sizeof *stack);
    stack->next = NULL;
    stack->node = root;
    while (stack) {
        struct item *top = stack;
        struct node *n = top->node;
        stack = top->next;
        free(top);
        if (n->left) {
            top = malloc(sizeof *top);
            top->next = stack;
            top->node = n->left;
            stack = top;
        }
        if (n->right) {
            top = malloc(sizeof *top);
            top->next = stack;
            top->node = n->right;
            stack = top;
        }
        free(n);
    }
}

int main(void)
{
    struct node *root = create();
    traverse(root);
    destroy(root);
    return 0;
}
